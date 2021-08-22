import * as Buffer from 'buffer';
import * as proto3 from '@grpc/proto-loader'

export interface Codec<I, O> {
  get name(): string

  encode(data: I): Buffer

  decode(data: Buffer): O
}

export type Decoder<T> = (data: Buffer) => T
export type Encoder<T> = (data: T) => Buffer

export class Json<I, O> implements Codec<I, O> {
  constructor() {
  }

  encode(data: I) {
    return Buffer.Buffer.from(JSON.stringify(data), 'utf8')
  }

  decode(data: Buffer) {
    return JSON.parse(data.toString('utf8')) as O
  }

  get name() {
    return 'json'
  }
}

export class Proto<I, O> implements Codec<I, O> {
  constructor(
    private readonly _def: proto3.MethodDefinition<I, unknown, O, unknown>,
  ) {
  }

  encode(data: I) {
    return this._def.responseSerialize(data)
  }

  decode(data: Buffer) {
    return this._def.requestDeserialize(data)
  }

  get name() {
    return 'proto'
  }
}