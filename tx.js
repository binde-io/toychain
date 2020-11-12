const bsv = require('bsv')
const axios = require('axios')
const fs = require('fs')
const sqlite3 = require('better-sqlite3')
const path = require('path')
/*************************************************************************************
const wallet = new Wallet({ xpriv: <xprivKey string> })
const tx = new Tx(wallet)
tx.add(<bsv.Transaction object>)                                // Add to tx db
tx.get({ id: <txid> })                                          // get tx by id
tx.get()                                                        // get all unsent txs
tx.push({ id: <txid> })                                         // push tx by id
tx.push()                                                       // push all unsent txs
tx.reset()                                                      // clear all txs
tx.size()                                                       // get total number of items on the table
tx.clone(<bsv.Transaction object>)                              // Clone a transaction ('genesis': 1)
*************************************************************************************/
const push_addr = process.env["NODE_ADDRESS_PUSH"] || 'https://api.whatsonchain.com/v1/bsv/main/tx/raw';
const tx_key = !!process.env["NODE_ADDRESS_PUSH"] ? "rawtx": "txhex"  // mapi vs. insight

class Tx {
  endpoint;
  constructor(wallet) {
    if (wallet.id) {
      let dbpath = path.resolve(wallet.meta.storage.path, "db/" + wallet.id)
      if (!fs.existsSync(dbpath)) {
        fs.mkdirSync(dbpath, { recursive: true })
      }
      this.DB = sqlite3(dbpath + "/tx.db")
      const stmt = this.DB.prepare("SELECT * FROM sqlite_master WHERE type='table'");
      const tables = stmt.all();
      const tablenames = tables.map((t) => t.name)
      if (!tablenames.includes("tx")) {
        this.DB.prepare("CREATE TABLE tx (id TEXT, tx TEXT, genesis INTEGER, sent INTEGER, PRIMARY KEY (id))").run()
      }
    }
  }
  reset() {
    this.DB.prepare("DELETE FROM tx").run()
  }
  size() {
    let count = this.DB.prepare("SELECT count(*) from tx WHERE sent=0").get();
    return count ? count["count(*)"] : 0;
  }
  clone(transaction) {
    return this.DB.prepare("INSERT INTO tx (id, tx, genesis, sent) VALUES (@id, @tx, @genesis, @sent)").run({
      id: transaction.id,
      genesis: 1,
      tx: transaction.toString("hex"),
      sent: 0
    })
  }
  add(transaction) {
    return this.DB.prepare("INSERT INTO tx (id, tx, genesis, sent) VALUES (@id, @tx, @genesis, @sent)").run({
      id: transaction.id,
      genesis: 0,
      tx: transaction.toString("hex"),
      sent: 0
    })
  }
  get(o) {
    if (o && ("id" in o)) {
      if(Array.isArray(o.id)) {
        const sql = `SELECT * FROM tx WHERE id IN (${o.id.map(() => '?').join(',')})`;
        return this.DB.prepare(sql).all(o.id);
      } else {
        return this.DB.prepare("SELECT * from tx WHERE id=?").all(o.id);
      }
    } else {
      return this.DB.prepare("SELECT * from tx WHERE sent=0").all();
    }
  }
  async push(o) {
    let items = this.get(o)
    let counter = 0;
    console.log("Pushing", items.length)
    for(let item of items) {
      if (!item.genesis) {
        let raw = item.tx
        if (o && o.except && o.except.includes(item.id)) {
          console.log("already sent", item.id)
        } else {
          console.log('pushing', raw.slice(0,30)+ "...")
          try {
            console.log("is it printing?")
            let res = await axios.post(push_addr, JSON.parse(`{ "${tx_key}": "${raw}" }`), {headers:{'Content-Type': 'application/json'}})
            console.log(`Push addr: ${push_addr}.\n    Response: ${JSON.stringify(res.data)} \n    Updating to sent: ${item.id}`)
            // Change to sent
            this.DB.prepare("UPDATE tx SET sent=1 WHERE id=?").run(item.id)
            counter++;
          } catch (e) {
            console.log("Error")
            console.log(`Error pushing transaction ${e.response.status}: ${JSON.stringify(e.response.data)}`)
            //e has the following keys:[ 'config', 'request', 'response', 'isAxiosError', 'toJSON' ]
            //console.log("Toychain: Error. Sent", counter)
            //throw(e);
            //process.exit();
          }
        }
      }
    }
  }
}
module.exports = Tx
