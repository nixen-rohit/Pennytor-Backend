import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Enforces: min 12 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char.
 * Kept as a single named decorator so the policy lives in one place —
 * change it here, not at every DTO that needs a password field.
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          if (value.length < 12) return false;
          if (!/[A-Z]/.test(value)) return false;
          if (!/[a-z]/.test(value)) return false;
          if (!/[0-9]/.test(value)) return false;
          if (!/[^A-Za-z0-9]/.test(value)) return false;
          return true;
        },
        defaultMessage(_args: ValidationArguments) {
          return 'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number, and a special character';
        },
      },
    });
  };
}
