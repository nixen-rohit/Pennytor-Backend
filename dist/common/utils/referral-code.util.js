"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReferralCode = generateReferralCode;
const crypto_1 = require("crypto");
function generateReferralCode() {
    return (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
}
//# sourceMappingURL=referral-code.util.js.map