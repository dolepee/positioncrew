#!/usr/bin/env python3
"""Register PositionCrew providers as ERC-8004 identities on BSC testnet.

The script uses the official BNB Agent SDK and keeps signing material outside
the repository. It verifies every public manifest before sending a transaction
and checkpoints receipts after each registration so interrupted runs resume
without duplicating completed identities.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

from bnbagent import AgentEndpoint, ERC8004Agent, EVMWalletProvider
from bnbagent.config import NetworkConfig


BASE_URL = "https://positioncrew.dolepee.com"
BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545"
BSC_TESTNET_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"

PROVIDERS = (
    {
        "slug": "lending-rescue",
        "name": "PositionCrew Lending Rescue",
        "category": "Health factor monitoring",
        "service": "LENDING_RESCUE",
        "description": (
            "Returns the smallest bounded repayment or collateral action that "
            "restores a stressed BSC lending position, or refuses unsafe work."
        ),
    },
    {
        "slug": "lp-rebalance",
        "name": "PositionCrew LP Range Operator",
        "category": "Rebalancing",
        "service": "LP_REBALANCE",
        "description": (
            "Proposes a bounded BSC LP range change only when projected fees "
            "clear swap and gas costs, or refuses the rebalance."
        ),
    },
    {
        "slug": "yield-optimization",
        "name": "PositionCrew Yield Allocator",
        "category": "Yield optimisation",
        "service": "YIELD_OPTIMIZATION",
        "description": (
            "Compares allowlisted BSC yield venues after costs, liquidity, "
            "lockup, concentration, and risk limits."
        ),
    },
    {
        "slug": "bounded-grid",
        "name": "PositionCrew Bounded Grid Builder",
        "category": "Grid trading",
        "service": "BOUNDED_GRID",
        "description": (
            "Builds or rejects a BSC grid under explicit inventory, loss, "
            "liquidity, volatility, and expiry limits."
        ),
    },
)


def read_password(path: Path) -> str:
    password = path.read_text(encoding="utf-8").strip()
    if not password:
        raise ValueError(f"Wallet password file is empty: {path}")
    return password


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schemaVersion": "positioncrew.bsc-identities.v1",
            "network": "bsc-testnet",
            "chainId": 97,
            "identityRegistry": BSC_TESTNET_REGISTRY,
            "source": "BNB Agent SDK 0.4.2",
            "providers": [],
        }
    return json.loads(path.read_text(encoding="utf-8"))


def write_checkpoint(path: Path, checkpoint: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(checkpoint, indent=2, sort_keys=False) + "\n"
    fd, temporary_path = tempfile.mkstemp(dir=path.parent, prefix=".identity-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise


def verify_manifest(slug: str) -> dict[str, Any]:
    url = f"{BASE_URL}/api/providers/{slug}/manifest"
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    manifest = response.json()
    provider = manifest.get("provider", {})
    if not provider.get("providerId", "").endswith(f":{slug}:v1"):
        raise ValueError(f"Manifest slug mismatch at {url}")
    if manifest.get("transport", {}).get("protocol") != "HTTPS_JSON":
        raise ValueError(f"Provider is not operational at {url}")
    manifest["manifestSha256"] = hashlib.sha256(response.content).hexdigest()
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--password-file", type=Path, required=True)
    parser.add_argument("--wallets-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    password = read_password(args.password_file)
    wallet = EVMWalletProvider(
        password=password,
        wallets_dir=args.wallets_dir,
    )
    # MegaFuel currently rejects these complete metadata URIs as too large.
    # Direct testnet gas preserves the same official SDK and registry path.
    network = NetworkConfig(
        name="bsc-testnet",
        chain_id=97,
        rpc_url=BSC_TESTNET_RPC,
        use_paymaster=False,
        registry_contract=BSC_TESTNET_REGISTRY,
    )
    sdk = ERC8004Agent(wallet_provider=wallet, network=network)
    checkpoint = load_checkpoint(args.output)
    completed = {entry["slug"] for entry in checkpoint["providers"]}

    checkpoint["owner"] = wallet.address
    checkpoint["baseUrl"] = BASE_URL

    for provider in PROVIDERS:
        if provider["slug"] in completed:
            print(f"SKIP {provider['slug']}: already checkpointed")
            continue

        manifest = verify_manifest(provider["slug"])
        manifest_url = f"{BASE_URL}/api/providers/{provider['slug']}/manifest"
        health_url = f"{BASE_URL}/api/providers/{provider['slug']}/health"
        agent_uri = sdk.generate_agent_uri(
            name=provider["name"],
            description=provider["description"],
            image=f"{BASE_URL}/positioncrew-mark.svg",
            endpoints=[
                AgentEndpoint(
                    name="web",
                    endpoint=manifest_url,
                    version="1.0.0",
                    capabilities=[provider["service"], "deterministic-refusal"],
                ),
                AgentEndpoint(
                    name="health",
                    endpoint=health_url,
                    version="1.0.0",
                ),
            ],
            supported_trust=["reputation"],
        )
        result = sdk.register_agent(
            agent_uri=agent_uri,
            metadata=[
                {"key": "operator", "value": "PositionCrew"},
                {"key": "category", "value": provider["category"]},
                {"key": "service", "value": provider["service"]},
                {"key": "manifest_sha256", "value": manifest["manifestSha256"]},
            ],
        )

        agent_id = int(result["agentId"])
        tx_hash = result["transactionHash"]
        checkpoint["providers"].append(
            {
                "slug": provider["slug"],
                "name": provider["name"],
                "category": provider["category"],
                "service": provider["service"],
                "agentId": agent_id,
                "owner": wallet.address,
                "manifestUrl": manifest_url,
                "manifestSha256": manifest["manifestSha256"],
                "registrationTransaction": tx_hash,
                "registeredAt": datetime.now(UTC).isoformat(),
            }
        )
        checkpoint["verifiedAt"] = datetime.now(UTC).isoformat()
        write_checkpoint(args.output, checkpoint)
        print(f"REGISTERED {provider['slug']}: agent {agent_id}, tx {tx_hash}")

    print(json.dumps({"owner": wallet.address, "providers": len(checkpoint["providers"])}))


if __name__ == "__main__":
    main()
