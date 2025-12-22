const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
require('dot-env-syncer').config();

const ADJUSTMENT_INTERVAL = 12000; // 12 seconds in milliseconds

async function getNextAdjustmentAndDiffTimeStamp(api, netuid) {
    // 1. Get the actual block number of the last time the price changed
    const lastAdjBlock = (await api.query.subtensorModule.lastAdjustmentBlock(netuid)).toNumber();
    const lastAdjBlockHash = await api.rpc.chain.getBlockHash(lastAdjBlock);
    const lastAdjBlockTimestamp = await api.query.timestamp.now.at(lastAdjBlockHash);
    const nowTimestamp = Date.now();
    const diffMs = nowTimestamp - lastAdjBlockTimestamp.toNumber();
    const gapBlockNumbers = Math.ceil(diffMs / ADJUSTMENT_INTERVAL);
    const modDiffMs = diffMs % ADJUSTMENT_INTERVAL;
    
    // 2. Get the interval constant for that subnet
    const adjInterval = (await api.query.subtensorModule.adjustmentInterval(netuid)).toNumber();
    
    // 3. The exact next adjustment block
    const nextAdjBlock = lastAdjBlock + adjInterval;
    
    // 4. Current height for comparison
    // const currentBlock = (await api.query.system.number()).toNumber();
    const currentBlock = lastAdjBlock + gapBlockNumbers;
    const blocksUntil = nextAdjBlock - gapBlockNumbers;
    
    return { blocksUntil, modDiffMs, currentBlock, lastAdjBlock, nextAdjBlock };
}

// Function to submit registration
async function submitRegistration(api, coldKey, netuid, hotKey, startTime) {
    // Prevent duplicate submissions
    if (submitRegistration.submitting) {
        console.log('Registration already in progress, skipping duplicate submission...');
        return;
    }
    submitRegistration.submitting = true;
    
    try {
        // 1. Fetch real-time burn/recycle cost
        const rawBurn = await api.query.subtensorModule.burn(netuid);
        const burnAmount = rawBurn.toBigInt();
        console.log(`Current registration cost for Subnet ${netuid}: ${Number(burnAmount) / 10**9} TAO`);
        console.log(`Cold Key: ${coldKey.address}`);
        
        // 2. Verify account has enough balance
        const { data: { free } } = await api.query.system.account(coldKey.address);
        const totalNeeded = burnAmount + BigInt(10000000);
        
        if (free.toBigInt() < totalNeeded) {
            throw new Error(`Insufficient Balance. Have: ${free.toBigInt() / 10n**9n} TAO, Need: ${totalNeeded / 10n**9n} TAO`);
        }

        // 3. Use recycleRegister or burnedRegister
        const registerTx = api.tx.subtensorModule.recycleRegister 
            ? api.tx.subtensorModule.recycleRegister(netuid, hotKey)
            : api.tx.subtensorModule.burnedRegister(netuid, hotKey);

        console.log(`Submitting registration...`);

        const unsub = await registerTx.signAndSend(coldKey, { tip: 1000000, nonce: -1 }, async ({ status, events, dispatchError }) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`Status: ${status.type} (Elapsed: ${elapsed}s)`);

            if (dispatchError) {
                if (dispatchError.isModule) {
                    const decoded = api.registry.findMetaError(dispatchError.asModule);
                    console.error(`Failed: ${decoded.section}.${decoded.name}`);
                } else {
                    console.error(`Failed: ${dispatchError.toString()}`);
                }
                unsub();
                submitRegistration.submitting = false; // Reset flag on error
                process.exit(1);
            } 
            
            if (status.isInBlock) {
                const blockHash = status.asInBlock;
                // Get block number from block hash
                try {
                    const block = await api.rpc.chain.getBlock(blockHash);
                    const blockNumber = block.block.header.number.toNumber();
                    const success = events.find(({ event }) => api.events.system.ExtrinsicSuccess.is(event));
                    if (success) console.log(`✅ Registration successful in block #${blockNumber}! (Elapsed: ${elapsed}s)`);
                } catch (error) {
                    console.error(`Error getting block number: ${error.message}`);
                    const success = events.find(({ event }) => api.events.system.ExtrinsicSuccess.is(event));
                    if (success) console.log(`✅ Registration successful in block! (Elapsed: ${elapsed}s)`);
                }
            } 
            
            if (status.isFinalized) {
                const blockHash = status.asFinalized;
                // Get block number from block hash
                try {
                    const block = await api.rpc.chain.getBlock(blockHash);
                    const blockNumber = block.block.header.number.toNumber();
                    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log(`Transaction Finalized in block #${blockNumber}.`);
                    console.log(`⏱️  Total elapsed time: ${totalElapsed} seconds`);
                    unsub();
                    process.exit(0);
                } catch (error) {
                    console.error(`Error getting block number: ${error.message}`);
                    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log("Transaction Finalized.");
                    console.log(`⏱️  Total elapsed time: ${totalElapsed} seconds`);
                    unsub();
                    process.exit(0);
                }
            }
        });
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`Critical Error: ${error.message} (Elapsed: ${elapsed}s)`);
        submitRegistration.submitting = false; // Reset flag on error
        process.exit(1);
    }
}

async function main() {
    const startTime = Date.now(); // Record start time
    
    const mnemonic = process.env.MNEMONIC;
    const netuid = process.env.NETUID; 
    const hotKey = process.env.HOT_KEY_ss58_address;
    const providerEndpoint = process.env.PROVIDER_ENDPOINT;
    // Validate all inputs are present and valid

    // Check mnemonic
    if (!mnemonic || typeof mnemonic !== "string" || mnemonic.trim().split(' ').length < 12) {
        console.error("MNEMONIC is missing or invalid in environment variables.");
        process.exit(1);
    }

    // Validate netuid: must be a number, non-negative, not empty
    if (!netuid || isNaN(Number(netuid)) || Number(netuid) < 0) {
        console.error("NETUID is missing or invalid (should be a non-negative number) in environment variables.");
        process.exit(1);
    }

    // Check hotKey: must be present and a ss58 address (starts with '5', usually 48 chars for Substrate)
    if (!hotKey || typeof hotKey !== "string" || !/^5[1-9A-HJ-NP-Za-km-z]{47,}$/.test(hotKey.trim())) {
        console.error("HOT_KEY_ss58_address is missing or invalid in environment variables.");
        process.exit(1);
    }

    // Validate providerEndpoint: should be a WebSocket URL
    if (!providerEndpoint || typeof providerEndpoint !== "string" || !providerEndpoint.startsWith("ws")) {
        console.error("PROVIDER_ENDPOINT is missing or invalid. Must be a ws:// or wss:// URL.");
        process.exit(1);
    }

    await cryptoWaitReady();

    const keyring = new Keyring({ type: 'sr25519' });
    const coldKey = keyring.addFromUri(mnemonic);
    const provider = new WsProvider(providerEndpoint);
    const api = await ApiPromise.create({ provider });

    try {
        console.log('Monitoring epoch timing...');
        
        // Get adjustment information
        const { blocksUntil, modDiffMs, currentBlock, lastAdjBlock, nextAdjBlock } = 
            await getNextAdjustmentAndDiffTimeStamp(api, netuid);
        
        const willWaitTimeForSync = ADJUSTMENT_INTERVAL - modDiffMs;
        
        console.log(`Blocks until next adjustment: ${blocksUntil}`);
        console.log(`Difference from current block: ${modDiffMs} ms (${(modDiffMs/1000).toFixed(2)} seconds)`);
        console.log(`Will wait for ${willWaitTimeForSync} ms (${(willWaitTimeForSync/1000).toFixed(2)} seconds) to sync`);
        console.log(`Current Block: ${currentBlock}`);
        console.log(`Last Adjustment happened at: ${lastAdjBlock}`);
        console.log(`Next Adjustment will happen at: ${nextAdjBlock}`);
        console.log(`Registration will trigger when block reaches: ${nextAdjBlock - 1}`);
        
        let registrationTriggered = false;
        let checkInterval;
        let unsubscribe;
        let registrationInterval = null;
        let currentBlockNumber = currentBlock;
        
        // Wait for sync timeout, then start monitoring blocks
        setTimeout(async () => {
            console.log('Sync timeout completed, starting block monitoring...');
            
            // Function to check current block and trigger registration
            const checkBlockAndTrigger = async () => {
                if (registrationTriggered) return;
                
                try {
                    // Check if we've reached nextAdjBlock - 1
                    if (currentBlockNumber >= nextAdjBlock - 1) {
                        if (!registrationTriggered) {
                            registrationTriggered = true;
                            console.log(`Block ${currentBlockNumber} reached! Starting registration attempts every 100ms...`);
                            
                            // Clear block monitoring interval
                            if (checkInterval) {
                                clearInterval(checkInterval);
                                checkInterval = null;
                            }
                            
                            // Start triggering registration every 100ms
                            registrationInterval = setInterval(() => {
                                submitRegistration(api, coldKey, netuid, hotKey, startTime);
                            }, 100);
                        }
                    } else {
                        const blocksRemaining = nextAdjBlock - currentBlockNumber;
                        // Calculate time to next adjustment (each block is 12 seconds)
                        const timeRemainingSeconds = blocksRemaining * 12;
                        const minutes = Math.floor(timeRemainingSeconds / 60);
                        const seconds = timeRemainingSeconds % 60;
                        
                        const timestamp = new Date().toISOString();
                        console.log(`[${timestamp}] Current Block: ${currentBlockNumber} | Blocks until trigger: ${blocksRemaining - 1} | Time to next adjustment: ${minutes}m ${seconds}s`);
                    }
                } catch (error) {
                    console.error(`Error in checkBlockAndTrigger: ${error.message}`);
                }
            };
            
            // Initial check
            await checkBlockAndTrigger();
            
            // Increment block number every 12 seconds (simulating block progression)
            checkInterval = setInterval(async () => {
                if (!registrationTriggered) {
                    currentBlockNumber++;
                    await checkBlockAndTrigger();
                } else {
                    clearInterval(checkInterval);
                }
            }, ADJUSTMENT_INTERVAL); // 12 seconds = 12000 milliseconds
            
        }, willWaitTimeForSync);
        
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`Critical Error: ${error.message} (Elapsed: ${elapsed}s)`);
        process.exit(1);
    }
}

main();