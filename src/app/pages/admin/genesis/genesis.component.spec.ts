import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AdminGenesisService,
  GenesisDeployResponse,
  GenesisDeploymentStatus,
} from '../../../services/admin-genesis.service';
import { GenesisComponent } from './genesis.component';

describe('GenesisComponent', () => {
  let fixture: ComponentFixture<GenesisComponent>;
  let component: GenesisComponent;
  let genesis: jasmine.SpyObj<AdminGenesisService>;

  beforeEach(async () => {
    genesis = jasmine.createSpyObj<AdminGenesisService>('AdminGenesisService', [
      'getDeployment',
      'dryRunProtocolDeploy',
      'deployProtocol',
    ]);

    await TestBed.configureTestingModule({
      imports: [GenesisComponent],
      providers: [
        provideRouter([]),
        { provide: AdminGenesisService, useValue: genesis },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenesisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('checks the current deployment with the pasted token', async () => {
    const status: GenesisDeploymentStatus = { deployed: false, manifest: null };
    genesis.getDeployment.and.resolveTo(status);
    component.tokenInput.set(' genesis-token ');

    await component.checkDeployment();

    expect(genesis.getDeployment).toHaveBeenCalledOnceWith(' genesis-token ');
    expect(component.status()).toEqual(status);
    expect(component.deployResult()).toBeNull();
    expect(component.error()).toBeNull();
  });

  it('dry-runs genesis with parameter and optional coin inputs', async () => {
    const result: GenesisDeployResponse = {
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    };
    genesis.dryRunProtocolDeploy.and.resolveTo(result);
    component.tokenInput.set('genesis-token');
    component.quorumBpsInput.set(6000);
    component.feePerSpendInput.set(2);
    component.poolCoinIdInput.set(' 0x' + '22'.repeat(32) + ' ');

    await component.dryRun();

    expect(genesis.dryRunProtocolDeploy).toHaveBeenCalledOnceWith(
      'genesis-token',
      jasmine.objectContaining({
        quorum_bps: 6000,
        fee_per_spend: 2,
        pool_coin_id: '0x' + '22'.repeat(32),
      }),
    );
    expect(component.deployResult()).toEqual(result);
    expect(component.manifestJson()).toContain('pool_launcher_id');
  });

  it('does not deploy when the browser confirmation is canceled', async () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.tokenInput.set('genesis-token');

    await component.deploy();

    expect(genesis.deployProtocol).not.toHaveBeenCalled();
  });

  it('deploys genesis after browser confirmation', async () => {
    const result: GenesisDeployResponse = {
      spend_bundle_id: '0x' + 'aa'.repeat(32),
      pushed: true,
      manifest: { tracker_launcher_id: '0x' + '33'.repeat(32) },
    };
    spyOn(window, 'confirm').and.returnValue(true);
    genesis.deployProtocol.and.resolveTo(result);
    component.tokenInput.set('genesis-token');

    await component.deploy();

    expect(genesis.deployProtocol).toHaveBeenCalledOnceWith(
      'genesis-token',
      jasmine.objectContaining({
        quorum_bps: 5000,
        fee_per_spend: 0,
      }),
    );
    const request = genesis.deployProtocol.calls.mostRecent().args[1];
    expect(request).toBeDefined();
    expect(request?.dry_run).toBeUndefined();
    expect(component.deployResult()).toEqual(result);
    expect(component.error()).toBeNull();
  });
});
