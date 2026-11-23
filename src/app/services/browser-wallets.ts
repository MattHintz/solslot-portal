export interface InjectedEthereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface BrowserWallet {
  provider: InjectedEthereum;
  label: string;
}

function read(object: unknown, key: string): unknown {
  try {
    return object && Reflect.get(Object(object), key);
  } catch {
    return undefined;
  }
}

// Keep the provider object itself. Extension names and flags are display hints.
export function watchBrowserWallets(update: (wallets: BrowserWallet[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const wallets = new Map<InjectedEthereum, string>();
  const add = (value: unknown, name?: unknown) => {
    if (typeof read(value, 'request') !== 'function') return;
    const provider = value as InjectedEthereum;
    const announced = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (!announced && wallets.has(provider)) return;
    const flags = [
      ['isRabby', 'Rabby'], ['isCoinbaseWallet', 'Coinbase Wallet'], ['isPhantom', 'Phantom'],
      ['isTrustWallet', 'Trust Wallet'], ['isRainbow', 'Rainbow'], ['isMetaMask', 'MetaMask'],
    ];
    const label = announced || flags.find(([flag]) => read(provider, flag) === true)?.[1] || 'Browser wallet';
    if (wallets.get(provider) === label) return;
    wallets.set(provider, label);
    update(Array.from(wallets, ([provider, label]) => ({ provider, label })));
  };
  const announce = (event: Event) => {
    const detail = read(event, 'detail');
    add(read(detail, 'provider'), read(read(detail, 'info'), 'name'));
  };
  window.addEventListener('eip6963:announceProvider', announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const legacy = read(window, 'ethereum');
  const multiple = read(legacy, 'providers');
  if (Array.isArray(multiple)) multiple.forEach(provider => add(provider));
  for (const key of ['coinbaseWalletExtension', 'rabby', 'trustwallet', 'rainbow']) add(read(window, key));
  add(read(read(window, 'phantom'), 'ethereum'));
  if (!wallets.size) add(legacy);
  return () => window.removeEventListener('eip6963:announceProvider', announce);
}
