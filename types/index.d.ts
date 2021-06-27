/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */
/* eslint space-infix-ops: 0 */

/// <reference types="node" />

import { Socket } from 'net'
import { Stream } from 'stream'
import { PeerCertificate } from 'tls'

export interface ConnectionDetails {
  ipAddress: string
  port: number
  ipFamily: number
  serverIpAddress: string
  isWebsocket: boolean
  isProxy: number
  certAuthorized?: boolean,
  cert?: PeerCertificate | {} | null,
  data?: Buffer
}

export type ProtocolDecoder = (
  conn: Stream,
  buffer: Buffer,
  req?: any
) => ConnectionDetails
export type ExtractSocketDetails = (socket: Socket) => ConnectionDetails | null

export declare const protocolDecoder: ProtocolDecoder
export declare const extractSocketDetails: ExtractSocketDetails
