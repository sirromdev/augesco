import { types, flow } from "mobx-state-tree";
import { web3Context } from "../constants";
import { BigNumber } from 'bignumber.js';
import getWeb3Network from "../utils/getWeb3Network"
import { contractInstance } from "./instanceContract"
import { transactionInstance } from "./instanceTx"
import { txStatus } from "../constants"

const web3Contexts = [
  web3Context.WEB3_LOAD_ERR,
  web3Context.WEB3_NET_ERR,
  web3Context.WEB3_LOADED,
  web3Context.WEB3_LOADING,
  web3Context.WEB3_LOCKED,
  web3Context.WEB3_CONTRACT_ERR
];

let ptx = null;
let nbh = null;

export const AugescoStore = types
  .model({
    account: types.optional(types.string, ""),
    balance: types.string,
    network: types.number,
    status: types.enumeration(web3Contexts),
    web3: types.optional(types.frozen()),
    web3_ws: types.optional(types.frozen()),
    witness: types.optional(types.frozen(), {}),
    contracts: types.map(contractInstance),
    transactions: types.map(transactionInstance),
    loaded: false,
    info: false
  })
  .actions(self => ({
    add(_id, _abi, _txHash, _address, _contract, _methods, _eventContract, _events) {
      self.contracts.set(_id, {
        name: _id,
        abi: _abi,
        txHash: _txHash,
        address: _address,
        contract: _contract,
        methods: _methods,
        eventContract: _eventContract,
        events: _events
      })
    },
    toggleLoaded() {
      self.loaded = !self.loaded
    },
    toggleInfo() {
      self.info = !self.info
    },
    setWeb3(web3) {
      self.web3 = web3;
    },
    setWeb3Websocket(web3_ws) {
      self.web3_ws = web3_ws;
    },
    setAccount(account) {
      self.account = account;
      self.updateStatus(web3Context.WEB3_LOADED);
    },
    setWitness(emitter) {
      self.witness = emitter;
    },
    updateStatus(status) {
      self.status = status;
    },
    updateBalance(balance) {
      self.balance = balance;
    },
    updateNetwork(network) {
      self.network = network;
    },
    use(_id) {
      if (self.loaded && self.contracts.has(_id)) {
        return self.contracts.get(_id)
      } else {
        return {}
      }
    },
    getMethod(_id, _method) {
      if (self.loaded && self.contracts.has(_id)) {
        return self.use(_id).getMethod(_method)
      } else {
        return {}
      }
    },
    createTx(_id) {
      self.transactions.set(_id, {
        hash: _id,
        receipt: {},
        status: txStatus.PENDING
      })
    },
    useTx(_id) {
      if (self.loaded && self.transactions.has(_id)) {
        return self.transactions.get(_id)
      } else {
        return {}
      }
    },
    startTx(_id) {
      self.useTx(_id).txStart()
    },
    call: flow(function* call(_id, _method, _args) {
      if (self.loaded && self.contracts.has(_id)) {
        try {
          return yield self.getMethod(_id, _method)["func"](..._args).call()
        } catch (error) {
          console.error(error)
        }
      } else {
        return undefined
      }
    }),
    exec: flow(function* exec(_id, _method, _args, _params) {
      if (self.loaded && self.contracts.has(_id)) {
        try {
          yield self.getMethod(_id, _method)["func"](..._args)
            .send(_params)
            .on('transactionHash', function (hash) {
              self.createTx(hash)
              self.startTx(hash)
            })
        } catch (error) {
          console.error(error)
        }
      } else {
        console.error("Not ready")
      }
    }),
    listen(_id, _event, _options, _cb) {
      if (self.loaded && self.contracts.has(_id)) {
        self.use(_id).events[_event](..._options, _cb)
      } else {
        console.error("Not ready")
      }
    },
    determineNetwork: flow(function* determineNetwork() {
      try {
        return yield self.web3.eth.net.getId();
      } catch (error) {
        self.updateStatus(web3Context.WEB3_NET_ERR);
      }
    }),
    startPendingTxs() {
      if (self.status === web3Context.WEB3_LOADED) {
        ptx = self.eventWeb3.eth.subscribe(
          "pendingTransactions",
          (err, result) => {
            self.witness.emit("ptx", result);
          }
        );
      }
    },
    stopPendingTxs() {
      ptx.unsubscribe((err, result) => {
        self.witness.emit("ptx-stopped", result);
      });
    },
    startNewBlocks(_cb) {
      if (self.status === web3Context.WEB3_LOADED) {
        nbh = self.eventWeb3.eth.subscribe("newBlockHeaders", (err, result) => {
          self.witness.emit("nbh", result);
        });
      }
    },
    stopNewBlocks() {
      nbh.unsubscribe((err, result) => {
        self.witness.emit("nbh-stopped", result);
      });
    }
  }))
  .views(self => ({
    get balanceEth() {
      const bal = new BigNumber(self.balance);
      return {
        balance: bal.shiftedBy(-18).toString(),
        denom: "eth"
      };
    },
    get balanceGwei() {
      const bal = new BigNumber(self.balance);
      return {
        balance: bal.shiftedBy(-9).toString(),
        denom: "gwei"
      };
    },
    get balanceWei() {
      const bal = new BigNumber(self.balance);
      return {
        balance: bal.toString(),
        denom: "wei"
      };
    },
    get netName() {
      return getWeb3Network(self.network);
    },
    get keys() {
      return Array.from(self.contracts.keys())
    },
    get values() {
      return Array.from(self.contracts.values())
    },
    get json() {
      return self.contracts.toJSON()
    }
  }));
