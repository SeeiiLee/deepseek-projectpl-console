const mode = process.env.FAKE_HARNESS_MODE ?? 'ready'

process.on('message', message => {
  if (message?.type !== 'shutdown') return
  if (mode === 'ignore-shutdown') return
  if (!process.connected) return
  if (mode === 'ack-exit-one') process.exitCode = 1
  process.send({ type: 'stopped' }, () => {
    if (process.connected) process.disconnect()
  })
})

if (mode === 'early-exit') {
  process.exitCode = 7
  process.disconnect()
} else if (mode === 'invalid-ready') {
  process.stdout.write('dsh web: http://127.1:54321\n')
} else if (mode === 'ready' || mode === 'ack-exit-one' || mode === 'ignore-shutdown') {
  process.stdout.write('booting\ndsh web: http://127.0.0.1:54321\n')
  process.send({ type: 'booted' })
} else if (mode === 'delayed-booted') {
  process.stdout.write('dsh web: http://127.0.0.1:54321\n')
  setTimeout(() => process.send({ type: 'booted' }), 200)
}
