import { Component, inject, signal } from '@angular/core';
import { StoreService } from '../store.service';

@Component({
  selector: 'app-header',
  template: `
    <header class="band">
      <div class="band-in">
        <div class="brand">
          @if (logo()) {
            <div class="plate"><img [src]="logo()" alt="GOSI logo" (error)="nextLogo()" /></div>
            <span class="sep" aria-hidden="true"></span>
          }
          <div class="org">
            <h1>API Documentation Engine</h1>
            <span class="sub">General Organization for Social Insurance · <span dir="rtl">المؤسسة العامة للتأمينات الاجتماعية</span></span>
            <span class="sub">Data Services · Integration</span>
          </div>
        </div>
        @if (store.sources(); as s) {
          <span class="mode" [class.mock]="s.brain.mode === 'mock'">AI · {{ s.brain.mode === 'mock' ? 'offline' : s.brain.model }}</span>
        }
      </div>
    </header>
  `,
})
export class HeaderComponent {
  readonly store = inject(StoreService);
  private readonly candidates = ['gosi-logo.svg', 'gosi-logo.png'];
  readonly logo = signal<string | null>(this.candidates[0]);

  nextLogo(): void {
    const i = this.candidates.indexOf(this.logo() ?? '');
    this.logo.set(this.candidates[i + 1] ?? null);
  }
}
