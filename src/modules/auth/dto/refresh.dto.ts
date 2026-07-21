import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({
    description:
      'Refresh token is delivered via HttpOnly cookie — this DTO exists only for Swagger documentation. ' +
      'The actual token is never sent in a JSON body.',
    required: false,
    readOnly: true,
  })
  readonly _cookieHint: string =
    'Refresh token is transmitted via the "refresh_token" HttpOnly cookie, not in the request body.';
}
