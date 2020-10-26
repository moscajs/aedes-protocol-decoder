'use strict'

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

function extractHttpDetails (req, socket) {
  const details = {}
  const headers = req && req.headers ? req.headers : null
  if (headers) {
    if (headers['x-forwarded-for']) {
      const addresses = forwarded(req)
      details.ipAddress = headers['x-real-ip'] ? headers['x-real-ip'] : addresses[addresses.length - 1]
      details.serverIpAddress = addresses[0]
    }
    if (headers['x-real-ip']) {
      details.ipAddress = headers['x-real-ip']
    }
    details.port = socket._socket.remotePort
    details.ipFamily = getProtoIpFamily(socket._socket.remoteFamily)
    details.isWebsocket = true
  }
  return details
}

function extractProxyDetails (buffer) {
  const details = {}
  let proxyProto
  if (isValidV1ProxyProtocol(buffer)) {
    proxyProto = proxyProtocol.V1BinaryProxyProtocol.parse(buffer)
    if (proxyProto && proxyProto.source && proxyProto.data) {
      details.ipFamily = getProtoIpFamily(proxyProto.inetProtocol)
      details.ipAddress = proxyProto.source.ipAddress
      details.port = proxyProto.source.port
      details.serverIpAddress = proxyProto.destination.ipAddress
      details.data = proxyProto.data
      details.isProxy = 1
    }
  } else if (isValidV2ProxyProtocol(buffer)) {
    proxyProto = proxyProtocol.V2ProxyProtocol.parse(buffer)
    if (proxyProto && proxyProto.proxyAddress && proxyProto.data) {
      if (proxyProto.proxyAddress instanceof proxyProtocol.IPv4ProxyAddress) {
        details.ipAddress = proxyProto.proxyAddress.sourceAddress.address.join('.')
        details.port = proxyProto.proxyAddress.sourcePort
        details.serverIpAddress = proxyProto.proxyAddress.destinationAddress.address.join('.')
        details.ipFamily = 4
      } else if (proxyProto.proxyAddress instanceof proxyProtocol.IPv6ProxyAddress) {
        details.ipAddress = parseIpV6Array(proxyProto.proxyAddress.sourceAddress.address)
        details.port = proxyProto.proxyAddress.sourcePort
        details.serverIpAddress = parseIpV6Array(proxyProto.proxyAddress.destinationAddress.address)
        details.ipFamily = 6
      }
      details.isProxy = 2
      details.data = Buffer.isBuffer(proxyProto.data) ? proxyProto.data : Buffer.from(proxyProto.data)
    }
  }
  return details
}

function extractSocketDetails (socket) {
  const details = {}
  if (socket._socket && socket._socket.address) {
    details.isWebsocket = true
    details.ipAddress = socket._socket.remoteAddress
    details.port = socket._socket.remotePort
    details.serverIpAddress = socket._socket.address().address
    details.ipFamily = getProtoIpFamily(socket._socket.remoteFamily)
  } else if (socket.address) {
    details.ipAddress = socket.remoteAddress
    details.port = socket.remotePort
    details.serverIpAddress = socket.address().address
    details.ipFamily = getProtoIpFamily(socket.remoteFamily)
  }
  return details
}

function protocolDecoder (conn, buffer, req) {
  let proto = {}
  if (!buffer) return proto
  const socket = conn.socket || conn
  proto.isProxy = 0
  proto.isWebsocket = false
  proto = { ...proto, ...extractHttpDetails(req, socket), ...extractProxyDetails(buffer) }

  if (!proto.ipAddress) {
    proto = { ...proto, ...extractSocketDetails(socket) }
  }

  return proto
}

module.exports = {
  extractSocketDetails,
  protocolDecoder
}
