import * as meta from './meta';
import {Meta} from './meta';

export type status = {
  code: code,
  meta: meta.Meta,
  message: string
}
export type code = number

export class Status {
  static OK: code = 0
  static CANCELLED: code = 1
  static UNKNOWN: code = 2
  static INVALID_ARGUMENT: code = 3
  static DEADLINE_EXCEEDED: code = 4
  static NOT_FOUND: code = 5
  static ALREADY_EXISTS: code = 6
  static PERMISSION_DENIED: code = 7
  static RESOURCE_EXHAUSTED: code = 8
  static FAILED_PRECONDITION: code = 9
  static ABORTED: code = 10
  static OUT_OF_RANGE: code = 11
  static UNIMPLEMENTED: code = 12
  static INTERNAL: code = 13
  static UNAVAILABLE: code = 14
  static DATA_LOSS: code = 15
  static UNAUTHENTICATED: code = 15

  constructor(private readonly _: Partial<status>) {
    this._.code ??= Status.UNKNOWN
    this._.message ||= 'Unknown Error'
    this._.meta ??= {}
  }
  toJSON(){
    return  {
      code:this._.code || Status.UNKNOWN,
      message:this._.message || 'Unknown Error',
      meta:this._.meta || {}
    }
  }
  get code() {
    return this._.code as code
  }

  get message() {
    return this._.message as string
  }

  get meta() {
    return this._.meta as Meta
  }
}
