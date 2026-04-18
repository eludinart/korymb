/**
 * Simple FTP/FTPS tester (CommonJS) using basic-ftp.
 * Usage:
 *   Set env vars or pass args: HOST USER PASS [PORT]
 *   Example (PowerShell):
 *     $env:HOST='eludein.art'; $env:USER='u945541167'; $env:PASS='mypassword'; node scripts/ftpTester.cjs
 *
 * Install:
 *   npm install basic-ftp
 */

const ftp = require('basic-ftp')

const host = process.env.HOST || process.argv[2]
const user = process.env.USER || process.argv[3]
const pass = process.env.PASS || process.argv[4]
const port = parseInt(process.env.PORT || process.argv[5] || '21', 10)

if (!host || !user || !pass) {
  console.error('Usage: set HOST/USER/PASS env or pass args: HOST USER PASS [PORT]')
  process.exit(1)
}

const tests = [
  { secure: false, label: 'FTP (plain)' },
  { secure: true, label: 'FTPS (explicit)' }
]

async function runTest(opt) {
  const client = new ftp.Client()
  client.ftp.verbose = false
  const cfg = { host, port, user, password: pass, secure: opt.secure }
  console.log('\n== Test:', opt.label, JSON.stringify(cfg))
  try {
    await client.access(cfg)
    const pwd = await client.pwd()
    console.log('Connected. PWD:', pwd)
    const list = await client.list()
    console.log('List count:', list.length)
    await client.close()
    return { ok: true }
  } catch (err) {
    console.error('Error:', err.code || err.message || err)
    client.close()
    return { ok: false, err }
  }
}

(async ()=>{
  for (const t of tests) {
    await runTest(t)
  }
  console.log('\nDone. If connection succeeds intermittently, try again with a short delay and check hosting panel for limits.');
})()
