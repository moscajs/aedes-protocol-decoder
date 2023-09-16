'use strict'

/**
 * @typedef ConnectionDetails
 * @property {string} ipAddress
 * @property {number} port
 * @property {string} serverIpAddress
 * @property {number} serverPort
 * @property {4 | 6 | 0} ipFamily
 * @property {boolean} isWebsocket
 * @property {boolean} isTls
 * @property {0 | 1 | 2} isProxy
 * @property {boolean | undefined} certAuthorized
 * @property {object | import('tls').PeerCertificate | undefined} cert
 * @property {Buffer | undefined} data
 */

/**
 * @typedef HttpConnection
 * @property { import('net').Socket } _socket
 */

const proxyProtocol = require('proxy-protocol-js')
const forwarded = require('forwarded')

const v1ProxyProtocolSignature = Buffer.from('PROXY ', 'utf8')
const v2ProxyProtocolSignature = Buffer.from('0d0a0d0a000d0a515549540a', 'hex')

function isValidV1ProxyProtocol (buffer) {
  for (let i = 0; i < v1ProxyProtocolSignature.length; i++) {
    if (buffer[i] !== v1ProxyProtocolSignature[i]) {
      return false
    }
  }
  return true
}

function isValidV2ProxyProtocol (buffer) {
  for (let i = 0; i < v2ProxyProtocolSignature.length; i++) {
    if (buffer[i] !== v2ProxyProtocolSignature[i]) {
      return false
    }
  }
  return true
}

// from https://stackoverflow.com/questions/57077161/how-do-i-convert-hex-buffer-to-ipv6-in-javascript
function parseIpV6Array (ip) {
  const ipHex = Buffer.from(ip).toString('hex')
  return ipHex.match(/.{1,4}/g)
    .map((val) => val.replace(/^0+/, ''))
    .join(':')
    .replace(/0000:/g, ':')
    .replace(/:{2,}/g, '::')
}

function getProtoIpFamily (ipFamily) {
  if (ipFamily && ipFamily.endsWith('4')) {
    return 4
  } else if (ipFamily && ipFamily.endsWith('6')) {
    return 6
  }
  return 0
}

/**
 *
 * @param {import('http').IncomingMessage} req
 * @param {HttpConnection} socket
 * @param {ConnectionDetails} proto
 * @returns {ConnectionDetails}
 * @todo replace socket arg by req.socket ?
 */
function extractHttpDetails (req, socket, proto = {}) {
  const headers = req && req.headers ? req.headers : null
  if (headers) {
    if (headers['x-forwarded-for']) {
      const addresses = forwarded(req)
      proto.ipAddress = headers['x-real-ip'] ? headers['x-real-ip'] : addresses[addresses.length - 1]
      proto.serverIpAddress = addresses[0]
    }
    if (headers['x-real-ip']) {
      proto.ipAddress = headers['x-real-ip']
    }
    // ? should we try to parse req.url to get the port first and then fallback to socket.address()?.port ?
    proto.serverPort = socket._socket.address()?.port
    proto.port = socket._socket.remotePort
    proto.ipFamily = getProtoIpFamily(socket._socket.remoteFamily)
    proto.isWebsocket = true
  }
  return proto
}

/**
 *
 * @param {Buffer} buffer
 * @param {ConnectionDetails} proto
 * @returns {ConnectionDetails}
 */
function extractProxyDetails (buffer, proto = {}) {
  let proxyProto
  if (isValidV1ProxyProtocol(buffer)) {
    proxyProto = proxyProtocol.V1BinaryProxyProtocol.parse(buffer)
    if (proxyProto && proxyProto.source && proxyProto.data) {
      proto.ipFamily = getProtoIpFamily(proxyProto.inetProtocol)
      proto.ipAddress = proxyProto.source.ipAddress
      proto.port = proxyProto.source.port
      proto.serverIpAddress = proxyProto.destination.ipAddress
      proto.serverPort = proxyProto.destination.port
      proto.data = proxyProto.data
      proto.isProxy = 1
    }
  } else if (isValidV2ProxyProtocol(buffer)) {
    proxyProto = proxyProtocol.V2ProxyProtocol.parse(buffer)
    if (proxyProto && proxyProto.proxyAddress && proxyProto.data) {
      if (proxyProto.proxyAddress instanceof proxyProtocol.IPv4ProxyAddress) {
        proto.ipAddress = proxyProto.proxyAddress.sourceAddress.address.join('.')
        proto.port = proxyProto.proxyAddress.sourcePort
        proto.serverIpAddress = proxyProto.proxyAddress.destinationAddress.address.join('.')
        proto.serverPort = proxyProto.proxyAddress.destinationPort
        proto.ipFamily = 4
      } else if (proxyProto.proxyAddress instanceof proxyProtocol.IPv6ProxyAddress) {
        proto.ipAddress = parseIpV6Array(proxyProto.proxyAddress.sourceAddress.address)
        proto.port = proxyProto.proxyAddress.sourcePort
        proto.serverIpAddress = parseIpV6Array(proxyProto.proxyAddress.destinationAddress.address)
        proto.serverPort = proxyProto.proxyAddress.destinationPort
        proto.ipFamily = 6
      }
      proto.isProxy = 2
      proto.data = Buffer.isBuffer(proxyProto.data) ? proxyProto.data : Buffer.from(proxyProto.data)
    }
  }
  return proto
}

/**
 *
 * @param {import('net').Socket | HttpConnection} socket
 * @param {ConnectionDetails} proto
 * @returns {ConnectionDetails}
 */
function extractSocketTLSDetails (socket, proto = {}) {
  socket = socket._socket || socket
  if (socket.getPeerCertificate && typeof socket.getPeerCertificate === 'function') {
    proto.certAuthorized = socket.authorized
    proto.cert = socket.getPeerCertificate(true)
    proto.isTls = true
  }
  return proto
}

/**
 *
 * @param {import('net').Socket | HttpConnection} socket
 * @param {ConnectionDetails} proto
 * @returns {ConnectionDetails}
 */
function extractSocketDetails (socket, proto = {}) {
  if (socket._socket && socket._socket.address) {
    proto.isWebsocket = true
    proto.ipAddress = socket._socket.remoteAddress
    proto.port = socket._socket.remotePort
    proto.serverIpAddress = socket._socket.address().address
    proto.serverPort = socket._socket.address().port
    proto.ipFamily = getProtoIpFamily(socket._socket.remoteFamily)
  } else if (socket.address) {
    proto.ipAddress = socket.remoteAddress
    proto.port = socket.remotePort
    proto.serverIpAddress = socket.address().address
    proto.serverPort = socket.address().port
    proto.ipFamily = getProtoIpFamily(socket.remoteFamily)
  }
  extractSocketTLSDetails(socket, proto)
  return proto
}

/**
 *
 * @param {import('aedes').Connection} conn
 * @param {Buffer} buffer
 * @param {import('http').IncomingMessage} req
 * @returns {ConnectionDetails}
 */
function protocolDecoder (conn, buffer, req) {
  const proto = {
    isProxy: 0,
    isWebsocket: false,
    isTls: false
  }
  if (!buffer) return proto
  const socket = conn.socket || conn
  extractHttpDetails(req, socket, proto)
  extractProxyDetails(buffer, proto)
  if (!proto.ipAddress) {
    extractSocketDetails(socket, proto)
  } else {
    extractSocketTLSDetails(socket, proto)
  }

  return proto
}

module.exports = {
  extractSocketDetails,
  protocolDecoder
}
