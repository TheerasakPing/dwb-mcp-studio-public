# Distribution boundary

The release contains DWB's core source, compiled JavaScript, setup scripts, tests and documentation. DWB code is covered by the included MIT LICENSE.

The release does not contain Node.js, Desktop Commander, Desktop Commander Remote, OpenAI tunnel, other tunnel clients, third-party binaries, node_modules, accounts, API keys or runtime data. It is not an official release of those projects and does not grant access to their services.

When the user clicks Install in Setup, their machine downloads Desktop Commander 0.2.50 from npm and tunnel-client 0.0.11 from the [official OpenAI release](https://github.com/openai/tunnel-client/releases/tag/v0.0.11), into this DWB installation's `external` folder. These downloads are separate from the distributed ZIP. Their upstream licenses apply and are retained. See [sources and installation](docs/EXTERNAL.md).

The package manifests reference MCP SDK libraries, Zod and development tools. npm downloads these dependencies on the user's machine during setup; their own licenses apply. They are not vendored or bundled in DWB's ZIP. `npm ci --omit=dev` does not install Desktop Commander or a tunnel.

The DWB worker loader redirects the supported external worker's configuration-home expression in memory. It does not copy the external package into a release or alter the user's installed files. The test fixture under the DWB test script is an original minimal MCP test double.
