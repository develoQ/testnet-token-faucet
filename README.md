# XRP Ledger Testnet Token Faucet

Funds new Testnet accounts

## Usage

### Run the server:

````
npm install
NODE_ENV="production" PORT=3000 RIPPLED_URI="wss://testnet.xrpl-labs.com" FUNDING_ADDRESS=rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe FUNDING_SECRET=<secret> AMOUNT=10000 npm start
````

Do not run multiple instances of the Faucet application using the same funding address. Since the Faucet currently tracks the funding account's sequence number internally, a second instance of the Faucet would consume sequence numbers that the first instance considers to be available. This is a temporary error, though: clients can always retry, and retried requests will generally succeed.

### Fund a new account:

```
curl -X POST localhost:3000/accounts -H "Content-Type: application/json" -d '{"currency": "TST"}'
```

### Fund activated account:

```
curl -X POST localhost:3000/accounts -H "Content-Type: application/json" -d '{"destination":"rMjSqP75HrP7x9FbnPFHK3Da4yKrwTNoT6","currency": "TST"}'
```
## Run time options

Environment variables:

- `AMOUNT`: The number of Token to fund new accounts with. Default funding amount is 1,000.
