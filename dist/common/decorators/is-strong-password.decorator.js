"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsStrongPassword = IsStrongPassword;
const class_validator_1 = require("class-validator");
function IsStrongPassword(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isStrongPassword',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value) {
                    if (typeof value !== 'string')
                        return false;
                    if (value.length < 8)
                        return false;
                    if (!/[A-Z]/.test(value))
                        return false;
                    if (!/[a-z]/.test(value))
                        return false;
                    if (!/[0-9]/.test(value))
                        return false;
                    if (!/[^A-Za-z0-9]/.test(value))
                        return false;
                    return true;
                },
                defaultMessage() {
                    return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character';
                },
            },
        });
    };
}
//# sourceMappingURL=is-strong-password.decorator.js.map