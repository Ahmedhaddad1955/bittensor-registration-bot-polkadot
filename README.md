# Bittensor Subnet Registration Bot

Automated bot for registering hot keys to Subtensor subnets with precise timing to target specific adjustment blocks.

## Overview

This bot automatically registers your hot key to a Subtensor subnet by:

- Calculating the exact next adjustment block
- Synchronizing with the adjustment interval
- Simulating block progression (12 seconds per block)
- Triggering registration attempts at the optimal time

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
MNEMONIC=your_12_or_24_word_mnemonic_phrase
NETUID=68
HOT_KEY_ss58_address=5YourHotKeyAddressHere
PROVIDER_ENDPOINT=wss://bittensor-finney.api.onfinality.io/public-ws
```

### 3. Run

```bash
npm start
```

## Configuration

| Variable              | Description                     | Example                    |
| --------------------- | ------------------------------- | -------------------------- |
| `MNEMONIC`          | Cold key mnemonic (12/24 words) | `word1 word2 ... word24` |
| `NETUID`            | Subnet ID to register           | `68`                     |
| `HOT_KEY`           | Hot key address to register     | `5YourHotKey...`         |
| `PROVIDER_ENDPOINT` | Subtensor WebSocket endpoint    | `wss://...`              |

## How It Works

### Step 1: Timing Calculation

- Fetches last adjustment block and timestamp
- Calculates time difference and sync offset
- Determines next adjustment block number

### Step 2: Synchronization

- Waits for optimal sync time (`ADJUSTMENT_INTERVAL - modDiffMs`)
- Aligns with the 12-second adjustment interval

### Step 3: Block Monitoring

- Increments block number every 12 seconds (simulated)
- Displays: current block, blocks remaining, time until adjustment

### Step 4: Registration

- Triggers when block reaches `nextAdjBlock - 1`
- Submits registration every 100ms
- Uses `recycleRegister` (falls back to `burnedRegister`)

### Step 5: Monitoring

- Tracks transaction status
- Shows block number where included
- Displays total elapsed time

## Example Output

```
Monitoring epoch timing...
Blocks until next adjustment: 142
Difference from current block: 8520 ms (8.52 seconds)
Will wait for 3480 ms (3.48 seconds) to sync
Current Block: 7154950
Last Adjustment happened at: 7154800
Next Adjustment will happen at: 7155092
Registration will trigger when block reaches: 7155091

Sync timeout completed, starting block monitoring...
Current Block: 7154950 | Blocks until trigger: 141 | Time to next adjustment: 28m 12s
Current Block: 7154951 | Blocks until trigger: 140 | Time to next adjustment: 28m 0s
...

Block 7155091 reached! Starting registration attempts every 100ms...
Current registration cost for Subnet 68: 0.010688926 TAO
Cold Key: 5HVPfKXHqk3TXpCZDefReFcHDxVn8F6E35WsAUjYhcTHRVUm
Submitting registration...
Status: Ready (Elapsed: 887.47s)
Status: Broadcast (Elapsed: 887.50s)
✅ Registration successful in block #7155092! (Elapsed: 887.52s)
Transaction Finalized in block #7155092.
⏱️  Total elapsed time: 887.55 seconds
```

## Technical Details

### Block Timing

- **Block Time**: 12 seconds per block
- **Simulation**: Block progression is simulated (no constant chain queries)
- **Sync Interval**: 12,000ms (ADJUSTMENT_INTERVAL)

### Registration Strategy

- **Trigger Block**: `nextAdjBlock - 1`
- **Attempt Frequency**: Every 100ms
- **Transaction Settings**:
  - Tip: 1,000,000
  - Nonce: -1 (auto-increment)
- **Method**: `recycleRegister` (2025 standard) or `burnedRegister` (fallback)

### Safety Features

- ✅ Duplicate submission prevention
- ✅ Balance verification before submission
- ✅ Error handling with detailed messages
- ✅ Transaction status tracking

## Requirements

- **Node.js**: v14 or higher
- **Balance**: Registration cost + 0.01 TAO buffer
- **Network**: Stable connection to Subtensor endpoint

## Dependencies

- `@polkadot/api` ^16.5.4
- `dot-env-syncer` ^9.12.4

## Troubleshooting

### Insufficient Balance

```
Error: Insufficient Balance. Have: X TAO, Need: Y TAO
```

**Solution**: Ensure your cold key has registration cost + 0.01 TAO

### Invalid Transaction

```
Error: 1010: Invalid Transaction: Custom error: 6
```

**Possible Causes**:

- Registration window passed
- Hot key already registered
- Invalid hot key format

**Solution**: Verify hot key address and timing

### Connection Issues

**Solution**:

- Verify `PROVIDER_ENDPOINT` is correct
- Check network connectivity
- Try a different endpoint

## Important Notes

⚠️ **Block Simulation**: Block counting is simulated and may drift from actual chain blocks

⚠️ **Single Registration**: Bot exits after successful registration

⚠️ **Balance Check**: Always ensure sufficient TAO balance before running

## License

ISC

## Disclaimer

This software is provided as-is without warranty. Use at your own risk. Always test with small amounts first and verify your configuration.
