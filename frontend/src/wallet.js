import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CHAIN_ID = 61999;
export const CHAIN_ID_HEX = "0xF22F";
export const RPC_URL = "https://studio.genlayer.com/api";

export function hasInjected() {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

export function readClient() {
  return createClient({ chain: studionet });
}

export async function connectInjected() {
  if (!hasInjected()) {
    throw new Error("NO_WALLET");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) {
    throw new Error("NO_WALLET");
  }
  const address = accounts[0];
  const client = createClient({ chain: studionet, provider: window.ethereum, account: address });
  return { kind: "injected", address, client };
}

export async function ensureStudionet() {
  if (!hasInjected()) return false;
  try {
    const current = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(current, 16) === CHAIN_ID) return true;
  } catch {}
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
    return true;
  } catch (e) {
    if (e && e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "GenLayer Studionet",
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
        }],
      });
      return true;
    }
    throw e;
  }
}

export function createEphemeral() {
  const account = createAccount();
  const client = createClient({ chain: studionet, account });
  return { kind: "ephemeral", address: account.address, account, client };
}

export function shortAddress(address) {
  if (!address) return "";
  return address.slice(0, 6) + "…" + address.slice(-4);
}
