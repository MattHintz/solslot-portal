import { routes } from './app.routes';

describe('admin portal route boundary', () => {
  it('keeps the deterministic genesis desk available', () => {
    expect(routes.some((route) => route.path === 'admin/genesis')).toBeTrue();
  });

  it('exposes the pre-ceremony Safe ownership handoff without a chain-admin guard', () => {
    const route = routes.find((candidate) => candidate.path === 'admin/omnichain-activation');
    expect(route).toBeDefined();
    expect(route?.canActivate).toBeUndefined();
  });

  it('does not expose retired one-off bootstrap or authority launch screens', () => {
    const active = new Set(routes.map((route) => route.path));
    for (const path of [
      'admin/recovery',
      'admin/launch-protocol-config',
      'admin/launch-authority-v2',
      'admin/authority-v2/add-admin-slot',
      'admin/authority-v2/roster-spend-package-review',
    ]) {
      expect(active.has(path)).withContext(path).toBeFalse();
    }
  });
});
