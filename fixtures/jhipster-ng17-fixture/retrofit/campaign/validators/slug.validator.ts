import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Custom reactive-form validator. Migration target: a Zod refinement / RHF
 * validate function preserving the same error key.
 */
export function slugValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string | null;
    if (!value) {
      return null;
    }
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? null : { slug: { value } };
  };
}
