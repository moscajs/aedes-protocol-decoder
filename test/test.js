'use strict'

const test = require('tape').test
const aedes = require('aedes')
const { createServer } = require('aedes-server-factory')
const fs = require('fs')
const mqtt = require('mqtt')
const mqttPacket = require('mqtt-packet')
const net = require('net')
const proxyProtocol = require('proxy-protocol-js')
const { extractSocketDetails, protocolDecoder } = require('../index')

function start (options) {
  let broker
  let server
  let client

  if (options.broker) {
    broker = aedes(options.broker)
  }
  if (options.server) {
    server = createServer(broker, options.server)
  }
  if (options.client) {
    client = mqtt.connect(options.client)
  }

  return { broker, client, server }
}

function close ({ broker, client, server }, t) {
  if (client) {
    client.end(true)
  }
  if (broker) {
    broker.close()
  }
  if (server) {
    server.close()
  }
  if (t) {
    t.end()
  }
}

function generateProxyConnectPacket (clientIp, serverPort, proxyVersion = 1, ipFamily = 4) {
  const packet = {
    cmd: 'connect',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    clientId: 'my-client-proxyV1',
    keepalive: 0
  }

  if (proxyVersion === 1 && ipFamily === 4) {
    const src = new proxyProtocol.Peer(clientIp, 12345)
    const dst = new proxyProtocol.Peer('127.0.0.1', serverPort)
    return new proxyProtocol.V1BinaryProxyProtocol(
      proxyProtocol.INETProtocol.TCP4,
      src,
      dst,
      mqttPacket.generate(packet)
    ).build()
  } else if (proxyVersion === 2 && ipFamily === 4) {
    return new proxyProtocol.V2ProxyProtocol(
      proxyProtocol.Command.LOCAL,
      proxyProtocol.TransportProtocol.DGRAM,
      new proxyProtocol.IPv4ProxyAddress(
        proxyProtocol.IPv4Address.createFrom(clientIp.split('.')),
        12345,
        proxyProtocol.IPv4Address.createFrom([127, 0, 0, 1]),
        serverPort
      ),
      mqttPacket.generate(packet)
    ).build()
  } else if (proxyVersion === 2 && ipFamily === 6) {
    return new proxyProtocol.V2ProxyProtocol(
      proxyProtocol.Command.PROXY,
      proxyProtocol.TransportProtocol.STREAM,
      new proxyProtocol.IPv6ProxyAddress(
        proxyProtocol.IPv6Address.createFrom(clientIp),
        12345,
        proxyProtocol.IPv6Address.createWithEmptyAddress(),
        serverPort
      ),
      mqttPacket.generate(packet)
    ).build()
  }
  return null
}

test('tcp clients have access to the ipAddress from the socket', function (t) {
  t.plan(2)

  const port = 4883
  const clientIps = ['::ffff:127.0.0.1', '::1']
  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client && client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIps.includes(client.ip), true)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      trustProxy: false, extractSocketDetails, protocolDecoder
    },
    client: {
      port,
      keepalive: 0,
      clientId: 'mqtt-client',
      clean: false
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})

test('tcp proxied (protocol v1) clients have access to the ipAddress(v4)', function (t) {
  t.plan(2)

  const port = 4883
  const clientIp = '192.168.0.140'

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIp, client.ip)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        finish()
      }
    },
    server: {
      trustProxy: true, extractSocketDetails, protocolDecoder
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  const proxyPacket = generateProxyConnectPacket(clientIp, port, 1, 4)
  const client = net.connect({
    port,
    timeout: 0
  }, function () {
    client.write(proxyPacket)
  })

  function finish () {
    client.end()
    close(setup, t)
  }
})

test('tcp proxied (protocol v2) clients have access to the ipAddress(v4)', function (t) {
  t.plan(2)

  const port = 4883
  const clientIp = '192.168.0.140'

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIp, client.ip)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        finish()
      }
    },
    server: {
      trustProxy: true, extractSocketDetails, protocolDecoder
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  const proxyPacket = generateProxyConnectPacket(clientIp, port, 2, 4)
  const client = net.createConnection(
    {
      port,
      timeout: 0
    }, function () {
      client.write(proxyPacket)
    }
  )

  function finish () {
    client.end()
    close(setup, t)
  }
})

test('tcp proxied (protocol v2) clients have access to the ipAddress(v6)', function (t) {
  t.plan(2)

  const port = 4883
  const clientIpArray = [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 168, 1, 128]
  const clientIp = '::ffff:c0a8:180:'

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIp, client.ip)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        finish()
      }
    },
    server: {
      trustProxy: true, extractSocketDetails, protocolDecoder
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })

  const proxyPacket = generateProxyConnectPacket(clientIpArray, port, 2, 6)
  const client = net.createConnection(
    {
      port,
      timeout: 0
    }, function () {
      client.write(proxyPacket)
    }
  )

  function finish () {
    client.end()
    close(setup, t)
  }
})

test('websocket clients have access to the ipAddress from the socket (if no ip header)', function (t) {
  t.plan(2)

  // local client IPs might resolve slightly differently
  const clientIps = ['::ffff:127.0.0.1', '::1']
  const port = 4883

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIps.includes(client.ip), true)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      ws: true, trustProxy: false, extractSocketDetails, protocolDecoder
    },
    client: `ws://localhost:${port}`
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})

test('websocket proxied clients have access to the ipAddress from x-real-ip header', function (t) {
  t.plan(2)

  const clientIp = '192.168.0.140'
  const port = 4883

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIp, client.ip)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      ws: true, trustProxy: true, extractSocketDetails, protocolDecoder
    },
    client: {
      protocol: 'ws',
      host: 'localhost',
      port,
      wsOptions: {
        headers: {
          'X-Real-Ip': clientIp
        }
      }
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})

test('websocket proxied clients have access to the ipAddress from x-forwarded-for header', function (t) {
  t.plan(2)

  const clientIp = '192.168.0.140'
  const port = 4883

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails && client.connDetails.ipAddress) {
          client.ip = client.connDetails.ipAddress
          t.equal(clientIp, client.ip)
        } else {
          t.fail('no ip address present')
        }
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      ws: true, trustProxy: true, extractSocketDetails, protocolDecoder
    },
    client: {
      protocol: 'ws',
      host: 'localhost',
      port,
      wsOptions: {
        headers: {
          'X-Forwarded-For': clientIp
        }
      }
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})

test('tcp proxied (protocol v1) clients buffer contains MQTT packet and proxy header', function (t) {
  t.plan(3)

  const brokerPort = 4883
  const proxyPort = 4884
  const clientIp = '192.168.0.140'

  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        if (client.connDetails.data) {
          const parser = mqttPacket.parser({ protocolVersion: 3 })
          parser.on('packet', (parsedPacket) => {
            t.equal(JSON.stringify(parsedPacket), JSON.stringify(packet))
            done(null, true)
          })
          parser.on('error', () => {
            t.fail('no valid MQTT packet extracted from TCP buffer')
            done(null, true)
          })
          parser.parse(client.connDetails.data)
        } else {
          t.fail('no MQTT packet extracted from TCP buffer')
          done(null, true)
        }
      }
    },
    server: {
      trustProxy: true, extractSocketDetails, protocolDecoder
    }
  })

  setup.broker.on('clientDisconnect', function () {
    finish()
  })

  setup.server.listen(brokerPort, function (err) {
    t.error(err, 'no error')
  })

  const proxyServer = net.createServer()
  let proxyClient

  proxyServer.listen(proxyPort, function (err) {
    t.error(err, 'no error')
  })

  proxyServer.on('connection', function (socket) {
    socket.on('end', function () {
      proxyClient.connected = false
    })

    socket.on('data', function (data) {
      if (proxyClient && proxyClient.connected) {
        proxyClient.write(data)
      } else {
        const src = new proxyProtocol.Peer(clientIp, 12345)
        const dst = new proxyProtocol.Peer('127.0.0.1', proxyPort)
        const proxyPacket = new proxyProtocol.V1BinaryProxyProtocol(
          proxyProtocol.INETProtocol.TCP4,
          src,
          dst,
          data
        ).build()
        proxyClient = net.connect({
          port: brokerPort,
          timeout: 0
        }, function () {
          proxyClient.write(proxyPacket, function () {
            proxyClient.connected = true
          })
        })
      }
    })
  })

  const packet = {
    cmd: 'connect',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clean: true,
    clientId: 'my-client-proxyV1',
    keepalive: 0
  }

  const client = net.connect({
    port: proxyPort,
    timeout: 250
  }, function () {
    client.write(mqttPacket.generate(packet))
  })

  client.on('timeout', function () {
    client.end(mqttPacket.generate({ cmd: 'disconnect' }))
  })

  function finish () {
    close(setup)
    proxyServer.close()
    t.end()
  }
})

test('tls over tcp clients have access to the certificate from the socket', function (t) {
  t.plan(3)

  const port = 8883
  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        t.equal(true, client.connDetails.certAuthorized)
        t.equal('Mosca', client.connDetails.cert.issuer.O)
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      tls: {
        key: fs.readFileSync('./test/fixtures/server.key'),
        cert: fs.readFileSync('./test/fixtures/server-crt.pem'),
        ca: fs.readFileSync('./test/fixtures/ec-cacert.pem'),
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      },
      extractSocketDetails,
      protocolDecoder
    },
    client: {
      port,
      keepalive: 0,
      clientId: 'mqtt-client',
      clean: false,
      protocol: 'mqtts',
      key: fs.readFileSync('./test/fixtures/client-1.key'),
      cert: fs.readFileSync('./test/fixtures/client-1-crt.pem'),
      ca: fs.readFileSync('./test/fixtures/ec-cacert.pem')
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})

test('tls over ws clients have access to the certificate from the socket', function (t) {
  t.plan(3)

  const clientIp = '192.168.0.140'
  const port = 8883
  const setup = start({
    broker: {
      preConnect: function (client, packet, done) {
        t.equal(true, client.connDetails.certAuthorized)
        t.equal('Mosca', client.connDetails.cert.issuer.O)
        done(null, true)
        close(setup, t)
      }
    },
    server: {
      ws: true,
      trustProxy: true,
      https: {
        key: fs.readFileSync('./test/fixtures/server.key'),
        cert: fs.readFileSync('./test/fixtures/server-crt.pem'),
        ca: fs.readFileSync('./test/fixtures/ec-cacert.pem'),
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      },
      extractSocketDetails,
      protocolDecoder
    },
    client: {
      port,
      keepalive: 0,
      clientId: 'mqtt-client',
      clean: false,
      protocol: 'wss',
      key: fs.readFileSync('./test/fixtures/client-1.key'),
      cert: fs.readFileSync('./test/fixtures/client-1-crt.pem'),
      ca: fs.readFileSync('./test/fixtures/ec-cacert.pem'),
      wsOptions: {
        headers: {
          'X-Forwarded-For': clientIp
        }
      }
    }
  })

  setup.server.listen(port, function (err) {
    t.error(err, 'no error')
  })
})
