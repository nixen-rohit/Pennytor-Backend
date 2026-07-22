"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class RefreshDto {
    constructor() {
        this._cookieHint = 'Refresh token is transmitted via the "refresh_token" HttpOnly cookie, not in the request body.';
    }
}
exports.RefreshDto = RefreshDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Refresh token is delivered via HttpOnly cookie — this DTO exists only for Swagger documentation. ' +
            'The actual token is never sent in a JSON body.',
        required: false,
        readOnly: true,
    }),
    __metadata("design:type", String)
], RefreshDto.prototype, "_cookieHint", void 0);
//# sourceMappingURL=refresh.dto.js.map