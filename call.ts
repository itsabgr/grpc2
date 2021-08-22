import {Codec} from './codec';
import * as http2 from 'http2';
import Ctx, {TimeoutError} from '../ctx';
import * as Meta from './meta';
import {code, Status} from './status';
import * as Buffer from 'buffer';
import {StreamDecoder} from '@grpc/grpc-js/src/stream-decoder';

const GRPC_ACCEPT_ENCODING_HEADER = 'grpc-accept-encoding';
const GRPC_ENCODING_HEADER = 'grpc-encoding';
const GRPC_MESSAGE_HEADER = 'grpc-message';
const GRPC_STATUS_HEADER = 'grpc-status';
const GRPC_TIMEOUT_HEADER = 'grpc-timeout';
const DEADLINE_REGEX = /(\d{1,8})\s*([HMSmun])/;

export type addr = {
  ip: string,
  port: number,
  family: addrFamily
}

export type addrFamily = 'IPv4' | 'IPv6'
export type kind = number
const deadlineUnitsToMs: { [_: string]: number } = {
  H: 3600000,
  M: 60000,
  S: 1000,
  m: 1,
  u: 0.001,
  n: 0.000001,
};

export class Call<I extends object, O extends object> extends Ctx<Status | Error> {
  static NoneStream: kind = 0b00
  static ClientStream: kind = 0b10
  static ServerStream: kind = 0b01
  static BothStream: kind = 0b11
  #sent = 0
  #metaSent = false
  #wantTrailers = false
  meta: Meta.Meta
  get codec(){
    return this._codec
  }
  constructor(
    private readonly _stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    private readonly _kind: kind,
    private readonly _codec: Codec<I,O>,
  ) {
    super((e) => {
      if (TimeoutError.is(e)) {
        try {
          this.sendError(new Status({
            code: Status.DEADLINE_EXCEEDED,
            message: 'Deadline exceeded',
          }));
        } catch (_) {
        }
        return
      }
      try {
        this.sendError(e ?? new Status({
          code: Status.ABORTED,
          message: 'Aborted',
        }))
      } catch (_) {
      }
    })
    this._stream.once('error', (e) => {
      this.close(e)
    })
    this._stream.once('close', () => {
      this.close()
    })
    {
      this.meta = Meta.decode(headers);
      const timeoutHeader = this.meta[GRPC_TIMEOUT_HEADER];
      if (Array.isArray(timeoutHeader) && typeof timeoutHeader[0] === 'string' && timeoutHeader.length > 0) {
        const matches = timeoutHeader.toString().match(DEADLINE_REGEX);
        if (!matches || matches.length < 3) {
          throw new Status({
            message: 'Invalid deadline',
            code: Status.OUT_OF_RANGE,
          })
        }
        //@ts-ignore
        const timeout = ((+matches[1]) * deadlineUnitsToMs[matches[2]]) | 0;

        const now = new Date();
        const deadline = now.setMilliseconds(now.getMilliseconds() + timeout);
        this.timeout(deadline)
        delete this.meta[GRPC_TIMEOUT_HEADER];
      }
      // Remove several headers that should not be propagated to the application
      delete this.meta[http2.constants.HTTP2_HEADER_ACCEPT_ENCODING];
      delete this.meta[http2.constants.HTTP2_HEADER_TE];
      delete this.meta[http2.constants.HTTP2_HEADER_CONTENT_TYPE];
      delete this.meta['grpc-encoding'];
      delete this.meta['grpc-accept-encoding'];
    }
  }

  sendMeta(meta?: Meta.Meta) {
    if (this._stream.closed || this.#metaSent) {
      return
    }
    this.#metaSent = true
    this._stream.respond(
      Object.assign({
        [GRPC_ACCEPT_ENCODING_HEADER]: 'identity',
        [GRPC_ENCODING_HEADER]: 'identity',
        [http2.constants.HTTP2_HEADER_STATUS]: http2.constants.HTTP_STATUS_OK,
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: `application/grpc+${this._codec.name}`,
      }, meta || {}),
      {waitForTrailers: true},
    )
  }

  private encodeMessage(data: I) {
    const messageBuffer = this._codec.encode(data);

    const byteLength = messageBuffer.byteLength;
    //@ts-ignore
    const output = Buffer.allocUnsafe(byteLength + 5);
    output.writeUInt8(0, 0);
    output.writeUInt32BE(byteLength, 1);
    messageBuffer.copy(output, 5);
    return output;
  }

  decodeMessage(data: Buffer) {
    const receivedMessage = data.slice(5);
    return this._codec.decode(receivedMessage);
  }

  sendStatus(status: Status) {
    if (this._stream.closed) {
      return
    }
    if (this.#wantTrailers) {
      return;
    }
    this._stream.once('wantTrailers', () => {
      this._stream.sendTrailers(Object.assign(
        {
          [GRPC_STATUS_HEADER]: status.code,
          [GRPC_MESSAGE_HEADER]: encodeURI(status.message),
        },
        Meta.encode(status.meta),
      ));
    })
    this.sendMeta()
    this.close()
  }

  sendError(e: Error & {
    code?: code,
    message?: string,
    meta?: Meta.Meta
  } | Status) {
    this.sendStatus(new Status({
      code: e.code,
      message: e.message,
      meta: e.meta,
    }))
    this._stream.end()
  }

  get kind() {
    return this._kind
  }

  get peer(): Partial<addr> {
    return {
      port: this._stream.session.socket.remotePort,
      ip: this._stream.session.socket.remoteAddress,
      family: this._stream.session.socket.remoteFamily as addrFamily,
    }
  }

  get id() {
    return this._stream.id
  }

  get sent() {
    return this.#sent
  }

  write(data: Buffer) {
    if (this._stream.writable) {
      return
    }
    this.sendMeta()
    return this._stream.write(data)
  }

  send(data: I) {
    return new Promise<void>((resolve, reject) => {
      try {
        const buff = this.encodeMessage(data)
        if (this.write(buff)) {
          resolve()
          return
        }
        this._stream.once('drain', () => {
          resolve()
        })
        ++this.#sent
      } catch (e) {
        this.close(e)
        reject(e)
      }
    })
  }

  #isReading = false

  async* [Symbol.asyncIterator](): AsyncIterable<O> {
    if (this.#isReading
    ) {
      throw new Error('call is already reading')
    }

    this.#isReading = true
    try {
      switch (this._kind) {
        case Call.ServerStream:
        case Call.NoneStream:
          const chunks = new Array<Buffer>()
          for await(const chunk of this._stream) {
            chunks.push(chunk)
          }
          // @ts-ignore
          return this.decodeMessage(Buffer.concat(chunks))
      }
      const decoder = new StreamDecoder();
      for await(const data of this._stream) {
        const messages = decoder.write(data)
        for (const message of messages) {
          yield this.decodeMessage(message)
        }
      }
    } catch (e) {
      this.close(new Status({
        code: Status.RESOURCE_EXHAUSTED,
        message: 'invalid codec',
      }))
    }
  }
}