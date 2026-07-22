import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

export interface CampaignEditComponentProps {
  campaign?: ICampaign | null;
}

export function CampaignEditComponent({ campaign }: CampaignEditComponentProps) {
  const fb = useFormBuilder(); // MIGRATION_TODO(di): was inject(FormBuilder); create this hook (or a context provider) for the ported service.
  const store = useStore(); // MIGRATION_TODO(di): was inject(Store); create this hook (or a context provider) for the ported service.
  const slugInvalid = (() => {
    const control = form.controls.slug;
    return control.invalid && control.touched;
  })(); // MIGRATION_TODO(derived): was computed()/getter; confirm no memo needed — reactive-form `form.controls` has no direct react-hook-form equivalent — port by hand (piped `.valueChanges` -> `watch(cb)` inside a `useEffect`, `.statusChanges` -> `formState`, `.controls`/`.get()` -> `register`/`getValues`)
  const form = useForm<{ name: string; slug: string; budget: number; active: boolean }>({
    defaultValues: {
      name: '',
      slug: '',
      budget: 0,
      active: true,
    },
  });
  // MIGRATION_TODO(forms): `form` was an Angular reactive form. Template bindings ([formGroup]/(ngSubmit)/formControlName, `.get()`/`.value`/`.invalid` reads) and method-body ops (`.value`->`getValues()`, `.patchValue/.setValue(v)`->`reset(v)`, `.get('x')?.setValue(v)`-> `setValue('x', v)`, `.markAllAsTouched()`->`trigger()`) are lowered. Verify the `patchValue`->`reset` sites: RHF `reset` replaces all fields and clears dirty/touched state, whereas Angular `patchValue` was a partial merge that preserved it.
  // MIGRATION_TODO(forms-validators): port Angular validators to a resolver (zod/yup + `useForm({ resolver })`) — name: [Validators.required, Validators.maxLength(60)]; slug: [Validators.required, slugValidator()]; budget: [Validators.required, Validators.min(0)]
  function submit(): void {
    if (!form.formState.isValid) {
      form.trigger();
      return;
    }
    const value = form.getRawValue();
    store.dispatch(
      CampaignActions.create({
        campaign: {
          id: null,
          name: value.name!,
          slug: value.slug!,
          budget: value.budget!,
          active: value.active!,
          tenantId: '',
        },
      }),
    );
  }
  // MIGRATION_TODO(effect): ngOnInit -> mount effect; verify deps ([])
  useEffect(() => {
    if (campaign) {
      form.reset(campaign);
    }
  }, []);

  return (
    <>{/* MIGRATION_TODO: structural directive/*transloco not deterministically supported */}</>
  );
}
