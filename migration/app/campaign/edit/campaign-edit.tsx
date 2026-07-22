import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { ICampaign } from '../campaign.model';
import { CampaignActions, useStore } from '../hooks/use-store';
import { isValidSlug } from '../validators/slug.validator';

export interface CampaignEditComponentProps {
  campaign?: ICampaign | null;
}

interface CampaignFormValues {
  name: string;
  slug: string;
  budget: number;
  active: boolean;
}

export function CampaignEditComponent({ campaign }: CampaignEditComponentProps) {
  const store = useStore();
  const form = useForm<CampaignFormValues>({
    defaultValues: {
      name: '',
      slug: '',
      budget: 0,
      active: true,
    },
  });
  const {
    register,
    handleSubmit,
    reset,
    trigger,
    formState: { errors, isValid, touchedFields },
  } = form;

  const slugInvalid = Boolean(errors.slug && touchedFields.slug);

  useEffect(() => {
    if (campaign) {
      reset(campaign);
    }
  }, [campaign, reset]);

  function submit(values: CampaignFormValues): void {
    if (!isValid) {
      void trigger();
      return;
    }
    store.dispatch(
      CampaignActions.create({
        id: null,
        name: values.name,
        slug: values.slug,
        budget: values.budget,
        active: values.active,
        tenantId: '',
      }),
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="mb-3">
        <label className="form-label" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          type="text"
          className="form-control"
          {...register('name', { required: true, maxLength: 60 })}
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="slug">
          Slug
        </label>
        <input
          id="slug"
          type="text"
          className={`form-control${slugInvalid ? ' is-invalid' : ''}`}
          {...register('slug', {
            required: true,
            validate: (value) => isValidSlug(value) || 'invalid',
          })}
        />
        {slugInvalid ? <div className="invalid-feedback">Slug must be lowercase, digits and dashes only</div> : null}
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="budget">
          Budget
        </label>
        <input
          id="budget"
          type="number"
          className="form-control"
          {...register('budget', { required: true, min: 0, valueAsNumber: true })}
        />
      </div>

      <div className="form-check mb-3">
        <input id="active" type="checkbox" className="form-check-input" {...register('active')} />
        <label className="form-check-label" htmlFor="active">
          Active
        </label>
      </div>

      <button type="submit" className="btn btn-primary" disabled={!isValid}>
        Save
      </button>
    </form>
  );
}
