// Import web3 for broadcasting transactions
var Web3 = require('web3');
// Import node-fetch to query the trading API
var fetch = require('node-fetch');
// import ethereumjs-tx to sign and serialise transactions
var Tx = require('ethereumjs-tx').Transaction;

const NETWORK = "ropsten";
const PROJECT_ID = "ENTER YOUR PROJECT ID";
// Connect to Infura’s ropsten node
const web3 = new Web3(new Web3.providers.HttpProvider(`https://${NETWORK}.infura.io/v3/${PROJECT_ID}`));
const NETWORK_URL = `https://${NETWORK}-api.kyber.network`;

// Representation of ETH as an address on Ropsten
const ETH_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// KNC contract address on Ropsten
const KNC_TOKEN_ADDRESS = '0x4E470dc7321E84CA96FcAEDD0C8aBCebbAEB68C6';
const ETH_DECIMALS = 18;
const KNC_DECIMALS = 18;
// How many KNC you want to sell
const QTY = 100;
// Gas price of the transaction
const GAS_PRICE = 'medium';

const USER_ACCOUNT = 'ENTER YOUR WALLET ADDRESS';
const PRIVATE_KEY = Buffer.from('ENTER YOUR PRIVATE KEY', 'hex');

async function main() {
    /*
    #################################
    ### CHECK IF KNC IS SUPPORTED ###
    #################################
    */

    // Querying the API /currencies endpoint
    let tokenInfoRequest = await fetch(
        `${NETWORK_URL}/currencies`
    );
    // Parsing the output
    let tokens = await tokenInfoRequest.json();
    console.log(JSON.stringify(tokens));

    // Checking to see if KNC is supported
    let supported = tokens.data.some(token => {
        return "KNC" == token.symbol;
    });
    // If not supported, return.
    if (!supported) {
        console.log("Token is not supported");
        return;
    }

    /*
    ####################################
    ### GET ETH/KNC CONVERSION RATES ###
    ####################################
    */

    // Querying the API /buy_rate endpoint
    /* let ratesRequest = await fetch(
        "https://ropsten-api.kyber.network/buy_rate?id=" +
        KNC_TOKEN_ADDRESS +
        "&qty=" +
        QTY
    );
    // Parsing the output
    let rates = await ratesRequest.json();
    console.log(JSON.stringify(rates));
    // Getting the source quantity
    let srcQty = rates.data[0].src_qty; */

    /*
    ####################################
    ### GET ENABLED STATUS OF WALLET ###
    ####################################
    */

    // Querying the API /users/<user_address>/currencies endpoint
    let enabledStatusesRequest = await fetch(
        "https://ropsten-api.kyber.network/users/" + USER_ACCOUNT + "/currencies"
    );
    // Parsing the output
    let enabledStatuses = await enabledStatusesRequest.json();
    // Checking to see if DAI is enabled
    let enabled = enabledStatuses.data.some(token => {
        if (token.id == KNC_TOKEN_ADDRESS.toLowerCase()) {
            return token.enabled;
        }
    });

    /*
    ####################################
    ### ENABLE WALLET IF NOT ENABLED ###
    ####################################
    */

    if (!enabled) {
        // Querying the API /users/<user_address>/currencies/<currency_id>/enable_data?gas_price=<gas_price> endpoint
        let enableTokenDetailsRequest = await fetch(
            "https://ropsten-api.kyber.network/users/" +
            USER_ACCOUNT +
            "/currencies/" +
            KNC_TOKEN_ADDRESS +
            "/enable_data?gas_price=" +
            GAS_PRICE
        );
        // Parsing the output
        let enableTokenDetails = await enableTokenDetailsRequest.json();
        // Extract the raw transaction details
        let rawTx = enableTokenDetails.data;
        console.log(rawTx);
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
        console.log(txReceipt);
    }


    /*
    #######################
    ### TRADE EXECUTION ###
    #######################
    */

    // Querying the API /trade_data endpoint
    // Note that a factor of 0.97 is used to account for slippage but you can use any value you want.
    let destAmount = await getQuoteAmount(KNC_TOKEN_ADDRESS, ETH_TOKEN_ADDRESS, QTY);
    let tradeDetailsRequest = await fetch(
        `${NETWORK_URL}/trade_data?user_address=` +
        USER_ACCOUNT +
        "&src_id=" +
        KNC_TOKEN_ADDRESS +
        "&dst_id=" +
        ETH_TOKEN_ADDRESS +
        "&src_qty=" +
        QTY +
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

main();