// A TCP proxy in front of the emulator whose link a test can cut and restore — how an emulator
// test takes one Firestore client offline without touching the gateway's code. Test-only.

import net from 'node:net'

export interface TcpProxy {
  port: number
  /** Drops every open connection and refuses new ones until `up()`. */
  down(): void
  up(): void
  close(): Promise<void>
}

export async function startTcpProxy(targetHost: string, targetPort: number): Promise<TcpProxy> {
  let online = true
  const sockets = new Set<net.Socket>()

  const server = net.createServer((client) => {
    if (!online) {
      client.destroy()
      return
    }
    const upstream = net.connect(targetPort, targetHost)
    for (const s of [client, upstream]) {
      sockets.add(s)
      s.on('close', () => sockets.delete(s))
      s.on('error', () => {
        client.destroy()
        upstream.destroy()
      })
    }
    client.pipe(upstream)
    upstream.pipe(client)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port

  return {
    port,
    down() {
      online = false
      for (const s of sockets) s.destroy()
    },
    up() {
      online = true
    },
    close() {
      for (const s of sockets) s.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
