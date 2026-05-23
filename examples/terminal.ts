/**
 * Example: open a terminal session against a QEMU VM and run a command.
 *
 * Run with:
 *   PBS_HOST=https://pbs.example.com:8007 \
 *   PBS_TOKEN='PBSAPIToken=root@pam!auto=...' \
 *   PBS_NODE=orca PBS_VMID=100 \
 *   npx tsx examples/terminal.ts
 */

import { Configuration, Pbs } from '../src';

async function main() {
    const token = process.env.PBS_TOKEN ?? '';
    const config = new Configuration({
        basePath: `${process.env.PBS_HOST ?? 'https://localhost:8007'}/api2/json`,
        apiKey: (name) => (name === 'Authorization' ? token : ''),
    });
    const pbs = new Pbs(config);
    const node = process.env.PBS_NODE ?? 'pbs1';
    const vmid = Number(process.env.PBS_VMID ?? 100);

    console.log(`Opening terminal on ${node}:qemu/${vmid}...`);
    const session = await pbs.connectTerminal(
        { kind: 'qemu', node, vmid },
        {
            onMessage: (text) => process.stdout.write(text),
            onClose: (event) => console.log(`\n[closed: ${event.code} ${event.reason}]`),
            onError: (event) => console.error(`\n[error: ${event}]`),
        },
    );

    // Resize the pty to a sensible size and run a single command.
    session.resize(120, 32);
    session.send('uname -a\n');

    // Read for 5 seconds, then close.
    await new Promise((r) => setTimeout(r, 5000));
    session.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
