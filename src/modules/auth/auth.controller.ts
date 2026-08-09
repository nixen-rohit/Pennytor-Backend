import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SessionAuthGuard, SESSION_COOKIE } from './guards/session-auth.guard';
import { SessionService } from '../session/session.service';
import { CsrfService, CSRF_COOKIE } from '../csrf/csrf.service';
import { SkipCsrf } from '../csrf/csrf.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const CSRF_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly csrfService: CsrfService,
    config: ConfigService,
  ) {
    this.isProd = config.get<string>('NODE_ENV', 'development') === 'production';
  }

  /**
   * Session cookie: HttpOnly (JS cannot read it → token theft via XSS is
   * impossible), SameSite=Lax (blocks cross-site delivery), Secure in
   * production, scoped to the API path. maxAge matches the session TTL —
   * when the cookie's lifetime ends, the server-side session has already
   * expired, so no orphan state can linger.
   */
  private sessionCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api',
      maxAge: this.sessionService.ttlMillis,
    };
  }

  private csrfCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api',
      maxAge: CSRF_MAX_AGE,
    };
  }

  private clearAuthCookies(res: { clearCookie: (n: string, o: CookieOptions) => void }) {
    res.clearCookie(SESSION_COOKIE, this.sessionCookieOptions());
    res.clearCookie(CSRF_COOKIE, this.csrfCookieOptions());
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SkipCsrf()
  @ApiOperation({ summary: 'Create a new account' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('check-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SkipCsrf()
  @ApiOperation({ summary: 'Log into an existing account' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials / Unverified email / Locked',
  })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // The session ID never leaves the server through JSON — it is delivered
    // exclusively via the HttpOnly cookie.
    const response = req.res!;
    response.cookie(
      SESSION_COOKIE,
      result.data.sessionId,
      this.sessionCookieOptions(),
    );

    // Arm the CSRF token for the very next state-changing request.
    const csrf = this.csrfService.issue();
    response.cookie(CSRF_COOKIE, csrf.cookieValue, this.csrfCookieOptions());

    const { sessionId, ...safeData } = result.data;
    return { message: result.message, data: { ...safeData, csrfToken: csrf.value } };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get the authenticated user for the current session',
    description:
      'Called on every page load. The session is restored entirely from ' +
      'the HttpOnly cookie — no token is ever stored client-side.',
  })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Not signed in / invalid session' })
  async me(@Req() req: Request) {
    const user = (req as Request & { user: { id: string } }).user;

    const result = await this.authService.me(user.id);

    const response = req.res!;
    const csrf = this.csrfService.issue();
    response.cookie(CSRF_COOKIE, csrf.cookieValue, this.csrfCookieOptions());

    return { data: { ...result.data, csrfToken: csrf.value } };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SkipCsrf()
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.authService.verifyEmail(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @SkipCsrf()
  resendOtp(@Body() dto: ResendOtpDto, @Req() req: Request) {
    return this.authService.resendOtp(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async logout(@Req() req: Request) {
    const user = (req as Request & { user: { id: string } }).user;
    const rawSessionId = (req.cookies as Record<string, string>)[SESSION_COOKIE];

    const result = await this.authService.logout(rawSessionId, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.clearAuthCookies(req.res!);
    return result;
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async logoutAll(@Req() req: Request) {
    const user = (req as Request & { user: { id: string } }).user;

    const result = await this.authService.logoutAll(user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.clearAuthCookies(req.res!);
    return result;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @SkipCsrf()
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SkipCsrf()
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = (req as Request & { user: { id: string } }).user;
    return this.authService.changePassword(user.id, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}