import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SiwsDto, SiwsNonceDto, MagicLinkDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('siws/nonce')
  @ApiOperation({ summary: 'Get nonce for Sign-In With Solana' })
  async getNonce(@Body() dto: SiwsNonceDto) {
    return this.authService.generateNonce(dto.walletAddress);
  }

  @Post('siws')
  @ApiOperation({ summary: 'Sign in with Solana wallet' })
  async signInWithSolana(@Body() dto: SiwsDto) {
    return this.authService.signInWithSolana(
      dto.walletAddress,
      dto.signature,
      dto.message,
      dto.nonce,
    );
  }

  @Post('magic-link')
  @ApiOperation({ summary: 'Request magic link for email sign in' })
  async requestMagicLink(@Body() dto: MagicLinkDto) {
    return this.authService.requestMagicLink(dto.email);
  }

  @Post('magic-link/verify')
  @ApiOperation({ summary: 'Verify magic link token' })
  async verifyMagicLink(@Body('token') token: string) {
    return this.authService.verifyMagicLink(token);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  async getCurrentUser(@Request() req: { user: { id: string } }) {
    return this.authService.getCurrentUser(req.user.id);
  }
}
