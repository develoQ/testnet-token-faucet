require('dotenv').config()
const express = require('express')
const cors = require('cors')
const app = express()
const port = process.env['PORT'] || 3000
const addressCodec = require('ripple-address-codec')
const { Client, Wallet, AccountSetAsfFlags } = require('xrpl')
const { isValidRepresentation } = require('./utils')
const { AccountRootFlags } = require('xrpl/dist/npm/models/ledger')

const rippledUri = process.env['RIPPLED_URI']
const address = process.env['FUNDING_ADDRESS']
const secret = process.env['FUNDING_SECRET']
const defaultAmount = process.env['AMOUNT'] || '1000'
const MAX_AMOUNT = '1000000'

app.use(cors())
app.use(express.json())

let txCount = 0
let txRequestCount = 0
/**
 * @type Client
 */
let api

async function createXRPLAPI() {
  if (api) {
    if (!api.isConnected()) {
      await api.connect()
      return
    } else {
      return
    }
  }

  api = new Client(rippledUri)
}

function setDefaultRippled() {
  createXRPLAPI().then(async () => {
    await api.connect()
    console.log(`----- | Checking defaultRipple`)
    
    console.log(`----- | Checking defaultRipple`)
    const response = await api.request({
      command: 'account_info',
      account: address,
    })
    if ((response.result.account_data.Flags & AccountRootFlags.lsfDefaultRipple) === 0) {
      console.log(`----- | Setting defaultRipple`)
      await api.submitAndWait({
        TransactionType: 'AccountSet',
        Account: address,
        SetFlag: AccountSetAsfFlags.asfDefaultRipple,
      }, { wallet: Wallet.fromSecret(secret) })
      console.log(`----- | Setted defaultRipple`)
    }
    console.log(`----- | Checked defaultRipple`)
  })
}

async function getDestAccount(req, res, reqId) {
  let account
  if (req.body.destination) {
    if (addressCodec.isValidClassicAddress(req.body.destination)) {
      let xAddress
      let classicAddress
      let tag

      if (req.body.destination.startsWith('T')) {
        const t = addressCodec.xAddressToClassicAddress(req.body.destination)
        xAddress = req.body.destination
        classicAddress = t.classicAddress
        tag = t.tag
      } else {
        xAddress = addressCodec.classicAddressToXAddress(req.body.destination, false, true)
        classicAddress = req.body.destination
      }
      account = {
        xAddress,
        classicAddress,
        address: classicAddress,
        tag
      }
    } else {
      return res.status(400).send({
        error: 'Invalid destination'
      })
    }
    console.log(`${reqId}| User-specified destination: ${account.xAddress}`)
  } else {
    console.log(`${reqId}| Generating new account`)
    await api.connect()
    const { wallet } = await api.fundWallet()
    account = wallet
    console.log(`${reqId}| Generated new account: ${account.address}`)
    console.log(`${reqId}| Setting TrustLine to ${req.body.currency}.${address}: ${account.address}`)
    await api.submitAndWait({
      TransactionType: 'TrustSet',
      Account: wallet.address,
      LimitAmount: {
        currency: req.body.currency,
        issuer: address,
        value: MAX_AMOUNT
      }
    }, { wallet })
    console.log(`${reqId}| Setted TrustLint to ${req.body.currency}.${address}: ${account.address}`)
  }
  return account
}

function checkForWarning(s) {
  if (s && s.warning) {
    console.log('GOT WARNING: ' + s.warning)
    // TODO: Look for this in the logs
  }
}

let nextAvailableSeq = null

app.post('/accounts', (req, res) => {
  txRequestCount++

  const reqId = (Math.random() + 1).toString(36).substr(2, 5)
  // const reqId = req.ip + req.secure ? ' s' : ' u'

  try {
    createXRPLAPI()
    getDestAccount(req, res, reqId).then(account => {
      let amount = defaultAmount
      if (req.body.amount) {
        // Disallows fractional amount
        if (!req.body.amount.match(/^\d+$/)) {
          return res.status(400).send({
            error: 'Invalid amount',
            detail: 'Must be an integer'
          })
        }
        let requestedAmountNumber = Number(req.body.amount)
        if (requestedAmountNumber < 0 || requestedAmountNumber > parseInt(MAX_AMOUNT) || typeof requestedAmountNumber !== 'number') {
          return res.status(400).send({
            error: 'Invalid amount'
          })
        }
        amount = requestedAmountNumber.toString()
      }
      if (!req.body?.currency) {
        console.log(`${reqId}| currency is required'`)
        return res.status(400).send({
          error: 'Invalid currency',
          detail: 'currency is required'
        })
      }
      if (!isValidRepresentation(req.body.currency)) {
        console.log(`${reqId}| Unsupported Currency representation: ${req.body.currency}'`)
        return res.status(400).send({
          error: 'Invalid currency',
          detail: `Unsupported Currency representation: ${req.body.currency}`,
        })
      }
      if (req.body.currency.toUpperCase() === 'XRP') {
        console.log(`${reqId}| Not Faucet of XRP'`)
        return res.status(400).send({
          error: 'Invalid currency',
          detail: `Not Faucet of XRP`,
        })
      }
      api.connect().then(() => {
        console.log(`${reqId}| (connected)`)
        if (nextAvailableSeq) {
          // next tx should use the next seq
          nextAvailableSeq++
          return nextAvailableSeq - 1
        } else {
          return getSequenceFromAccountInfo({ reqId, shouldAdvanceSequence: true })
        }
      }).then(sequence => {
        console.log(`${reqId}| Preparing payment with destination=${account.address}, sequence: ${sequence}`)

        return api.submitAndWait({
          TransactionType: 'Payment',
          Account: address,
          Destination: account.address,
          ...(account?.tag ? { DestinationTag: account?.tag } : {}),
          Amount: {
            currency: req.body.currency,
            issuer: address,
            value: amount,
          },
          Memos: req.body.memos ? [...req.body.memos] : []
        }, { wallet: Wallet.fromSecret(secret) })
      }).then((payment_result) => {
        checkForWarning(payment_result)
        const engine_result = payment_result.result.meta['TransactionResult']

        if (engine_result === 'tesSUCCESS' || engine_result === 'terQUEUED') {
          // || result.engine_result === 'terPRE_SEQ'
          console.log(`${reqId}| Funded ${account.address} with ${amount} ${req.body.currency}.${address} (${engine_result})`)
          const response = {
            account,
            amount: Number(amount)
          }
          if (!req.body.destination) {
            response.balance = Number(amount)
          }
          res.send(response)
          txCount++
        } else if (engine_result === 'tefPAST_SEQ' || engine_result === 'terPRE_SEQ') {
          // occurs when we re-connect to a different rippled server
          //???
          console.log(`${reqId}| Failed to fund ${account.address} with ${amount} ${currency}.${address} (${engine_result})`)
          res.status(503).send({
            error: 'Failed to fund account. Try again later',
            account
          })

          // advance cached sequence if needed:
          getSequenceFromAccountInfo({ reqId, shouldAdvanceSequence: false })
        } else if (engine_result === 'tecPATH_DRY') {
          console.log(`${reqId}| The trust line from ${req.body.destination} to ${req.body?.currency}.${account.address} with is not set.`)
          res.status(503).send({
            error: 'Trust line not set',
            account
          })
          console.log(`${reqId}| Setting nextAvailableSeq=null`)
          nextAvailableSeq = null
        } else {
          console.log(`${reqId}| Unrecognized failure to fund ${account.address} with ${amount} ${req.body?.currency}.${address} (${engine_result})`)
          res.status(503).send({
            error: 'Failed to fund account',
            account
          })
          // TODO: Look for this in the logs
          console.log(`${reqId}| Setting nextAvailableSeq=null`)
          nextAvailableSeq = null
        }
      }).catch(err => {
        console.log(err)
        console.log(`${reqId}| ${err}`)
        // [DisconnectedError(websocket was closed)]
        // from prepare* call
        res.status(500).send({
          error: 'Unable to fund account. Server load is too high. Try again later',
          account
        })
        nextAvailableSeq = null
      })
    }).catch(err => {
      console.log(`${reqId}| ${err}`)
      // [DisconnectedError(websocket was closed)]
      // from prepare* call
      res.status(500).send({
        error: err.message,
      })
      nextAvailableSeq = null
    })
  } catch (e) {
    console.log('/accounts error:', e)
    res.status(500).send({
      error: 'Internal Server Error'
    })
  }
})

// required:
// - options.reqId
// - options.shouldAdvanceSequence
function getSequenceFromAccountInfo(options) {
  const reqId = options.reqId

  console.log(`${reqId}| (requesting account info...)`)
  /**
   * @return require("xrpl").AccountInfoResponse
   */
  return api.request({
    command: 'account_info',
    account: address,
    strict: true,
    ledger_index: 'current',
    queue: true
  }).then((/** @type import("xrpl").AccountInfoResponse */ info) => {
    checkForWarning(info)

    let sequence

    sequence = info.result.account_data.Sequence
    if (info.result.queue_data && info.result.queue_data.transactions && info.result.queue_data.transactions.length) {
      const seqs = info.result.queue_data.transactions.reduce((acc, curr) => {
        acc.push(curr.seq)
      }, [])
      seqs.sort((a, b) => a - b) // numeric sort, low to high
      for (let i = 0; i < seqs.length; i++) {
        if (sequence === seqs[i]) {
          sequence++
        } else if (sequence < seqs[i]) {
          console.log(`${reqId}| WARNING: found gap in Sequence: account_data.Sequence=${info.result.account_data.Sequence}, sequence=${sequence}, seqs[${i}]=${seqs[i]}`)
        } else if (sequence > seqs[i]) {
          console.log(`${reqId}| ERROR: invariant violated: account_data.Sequence=${info.result.account_data.Sequence}, sequence=${sequence}, seqs[${i}]=${seqs[i]}`)
        }
      }
    }

    if (!nextAvailableSeq || nextAvailableSeq === sequence) {
      if (options.shouldAdvanceSequence === true) {
        // the sequence we found is the one we should use for this tx;
        // sequence + 1 will be the one to use in the next tx
        nextAvailableSeq = sequence + 1
      }
    } else if (nextAvailableSeq > sequence) {
      console.log(`${reqId}| WARNING: nextAvailableSeq=${nextAvailableSeq} > sequence=${sequence}. Some prior tx likely was not applied. Setting nextAvailableSeq=${options.shouldAdvanceSequence ? sequence : sequence + 1}.`)
      nextAvailableSeq = sequence
      // TODO: consider setting nextAvailableSeq=null
      if (options.shouldAdvanceSequence === true) {
        // sequence = nextAvailableSeq
        nextAvailableSeq++
      }
    } else if (nextAvailableSeq < sequence) {
      console.log(`${reqId}| WARNING: nextAvailableSeq=${nextAvailableSeq} < sequence=${sequence}. Another process/server is using this funding account, or we were disconnected and reconnected to a different rippled server`)
      nextAvailableSeq = sequence
      if (options.shouldAdvanceSequence === true) {
        nextAvailableSeq++
      }
    }
    console.log(`${reqId}| called account_info; sequence: ${sequence}, account_data.Sequence=${info.result.account_data.Sequence}, queue_data.transactions.length=${info.result.queue_data?.transactions?.length}`)

    return sequence
  })
}

setDefaultRippled()
const server = app.listen(port, () => console.log(`Altnet faucet, node version: ${process.version}, listening on port: ${port}`))
server.setTimeout(20 * 1000)

// Report TPS every minute
let peak = 0
let peakRequests = 0
setInterval(() => {
  if (txCount > peak) {
    peak = txCount
  }
  if (txRequestCount > peakRequests) {
    peakRequests = txRequestCount
  }
  console.log(`[TPS] success=${txCount}, tps=${(txCount / 60).toFixed(1)}, peak=${peak}, requests=${txRequestCount}, rps=${(txRequestCount / 60).toFixed(1)}, peakRequests=${peakRequests}, success%=${((txCount / txRequestCount) * 100).toFixed(1)}%, success_peak/request_peak=${((peak / peakRequests) * 100).toFixed(1)}%`)
  txCount = 0
  txRequestCount = 0
}, 60 * 1000)
