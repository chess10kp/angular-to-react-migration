import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';

import { ICampaign } from '../campaign.model';
import { CampaignActions } from '../store/campaign.actions';
import { slugValidator } from '../validators/slug.validator';

@Component({
  selector: 'app-campaign-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './campaign-edit.component.html',
})
export class CampaignEditComponent implements OnInit {
  private fb = inject(FormBuilder);
  private store = inject(Store);

  /** Resolved by `campaignResolver` and bound via `withComponentInputBinding`. */
  @Input() campaign: ICampaign | null = null;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    slug: ['', [Validators.required, slugValidator()]],
    budget: [0, [Validators.required, Validators.min(0)]],
    active: [true],
  });

  ngOnInit(): void {
    if (this.campaign) {
      this.form.patchValue(this.campaign);
    }
  }

  get slugInvalid(): boolean {
    const control = this.form.controls.slug;
    return control.invalid && control.touched;
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.store.dispatch(
      CampaignActions.create({
        campaign: { id: null, name: value.name!, slug: value.slug!, budget: value.budget!, active: value.active!, tenantId: '' },
      }),
    );
  }
}
