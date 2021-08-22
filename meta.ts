import http2 from 'http2';
import * as Buffer from 'buffer';


export type Meta = {[_:string]:(string | Buffer)[]}
export function encode(meta:Meta){
  const header = {} as http2.IncomingHttpHeaders
  for(const key in meta){
    // @ts-ignore
    header[key] = meta[key].map(val=>{
      if(Buffer.Buffer.isBuffer(val)){
        //@ts-ignore
        return val.toString('base64')
      }
      return val
    })
  }
  return header
}
export function decode(headers:http2.OutgoingHttpHeaders){
  const meta = {} as Meta;
  for (const key in headers){
    if (key.startsWith(':')) {
      continue;
    }
    let values = headers[key] as string|string[]
    if (!Array.isArray(values)){
      values = [...values.split(',')]
    }
    values = values.filter(val => val.length>0)
    if (values.length == 0){
      continue
    }
    if(key.endsWith('-bin')) {
      meta[key] = values.map(val => Buffer.Buffer.from(val, 'base64'))
      continue
    }
    meta[key] = values
  }
  return meta
}
