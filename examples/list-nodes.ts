/**
 * Example: list cluster nodes.
 *
 * Run with:
 *   PBS_HOST=https://pbs.example.com:8007 \
 *   PBS_TOKEN='PBSAPIToken=root@pam!auto:...' \
 *   npx tsx examples/list-nodes.ts
 */

import { Configuration, Pbs } from '../src';

async function main() {
    const token = process.env.PBS_TOKEN ?? '';
    const config = new Configuration({
        basePath: `${process.env.PBS_HOST ?? 'https://localhost:8007'}/api2/json`,
        // apiKey is called per security scheme (`Authorization`,
        // `PBSAuthCookie`, `CSRFPreventionToken`); supply the token
        // for the Authorization slot.
        apiKey: (name) => (name === 'Authorization' ? token : ''),
    });
    const pbs = new Pbs(config);

    const result = await pbs.nodes().getNodes();
    const nodes = result.data ?? [];
    console.log(`Found ${nodes.length} node(s):`);
    for (const node of nodes) {
        console.log(`  - ${node.node} (status=${node.status}, cpu=${node.cpu}, mem=${node.mem}/${node.maxmem})`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
