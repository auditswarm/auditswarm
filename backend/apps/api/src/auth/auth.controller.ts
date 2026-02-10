import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SiwsDto, SiwsNonceDto, MagicLinkDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('siws/nonce')
  @ApiOperation({ summary: 'Get nonce for Sign-In With Solana' })
  @ApiCreatedResponse({
    description: 'Nonce generated successfully',
    schema: {
      type: 'object',
      properties: {
        nonce: {
          type: 'string',
          description: 'Randomly generated nonce for signature verification',
          example: '1a2b3c4d5e6f7g8h9i0j',
        },
        expiresAt: {
          type: 'string',
          description: 'ISO 8601 timestamp when the nonce expires',
          example: '2026-02-06T12:30:00.000Z',
        },
      },
      required: ['nonce', 'expiresAt'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid wallet address format',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['walletAddress must be a valid Solana address'],
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  async getNonce(@Body() dto: SiwsNonceDto) {
    return this.authService.generateNonce(dto.walletAddress);
  }

  @Post('siws')
  @ApiOperation({ summary: 'Sign in with Solana wallet' })
  @ApiCreatedResponse({
    description: 'Successfully authenticated with Solana wallet',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          description: 'JWT access token for authenticated requests',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
        user: {
          type: 'object',
          description: 'Authenticated user information',
          properties: {
            id: {
              type: 'string',
              description: 'Unique user identifier',
              example: 'clx1a2b3c4d5e6f7g8h9i',
            },
            email: {
              type: 'string',
              nullable: true,
              description: 'User email address (if provided)',
              example: 'user@example.com',
            },
            name: {
              type: 'string',
              nullable: true,
              description: 'User display name',
              example: 'John Doe',
            },
            avatarUrl: {
              type: 'string',
              nullable: true,
              description: 'User avatar image URL',
              example: 'https://example.com/avatar.png',
            },
            defaultJurisdiction: {
              type: 'string',
              nullable: true,
              description: 'Default tax jurisdiction code',
              example: 'US',
            },
          },
          required: ['id'],
        },
      },
      required: ['accessToken', 'user'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid signature or expired nonce',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'string',
          example: 'Invalid signature or nonce expired',
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Signature verification failed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
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
  @ApiCreatedResponse({
    description: 'Magic link email sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Confirmation message',
          example: 'Magic link sent to your email',
        },
      },
      required: ['message'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid email format',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['email must be a valid email address'],
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  async requestMagicLink(@Body() dto: MagicLinkDto) {
    return this.authService.requestMagicLink(dto.email);
  }

  @Post('magic-link/verify')
  @ApiOperation({ summary: 'Verify magic link token' })
  @ApiOkResponse({
    description: 'Magic link verified successfully',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          description: 'JWT access token for authenticated requests',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
        user: {
          type: 'object',
          description: 'Authenticated user information',
          properties: {
            id: {
              type: 'string',
              description: 'Unique user identifier',
              example: 'clx1a2b3c4d5e6f7g8h9i',
            },
            email: {
              type: 'string',
              nullable: true,
              description: 'User email address',
              example: 'user@example.com',
            },
            name: {
              type: 'string',
              nullable: true,
              description: 'User display name',
              example: 'John Doe',
            },
            avatarUrl: {
              type: 'string',
              nullable: true,
              description: 'User avatar image URL',
              example: 'https://example.com/avatar.png',
            },
            defaultJurisdiction: {
              type: 'string',
              nullable: true,
              description: 'Default tax jurisdiction code',
              example: 'US',
            },
          },
          required: ['id'],
        },
      },
      required: ['accessToken', 'user'],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired token',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid or expired token' },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token verification failed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  async verifyMagicLink(@Body('token') token: string) {
    return this.authService.verifyMagicLink(token);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  @ApiOkResponse({
    description: 'Current user retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique user identifier',
          example: 'clx1a2b3c4d5e6f7g8h9i',
        },
        email: {
          type: 'string',
          nullable: true,
          description: 'User email address',
          example: 'user@example.com',
        },
        name: {
          type: 'string',
          nullable: true,
          description: 'User display name',
          example: 'John Doe',
        },
        avatarUrl: {
          type: 'string',
          nullable: true,
          description: 'User avatar image URL',
          example: 'https://example.com/avatar.png',
        },
        defaultJurisdiction: {
          type: 'string',
          nullable: true,
          description: 'Default tax jurisdiction code (US, EU, BR, etc.)',
          example: 'US',
        },
        preferences: {
          type: 'object',
          nullable: true,
          description: 'User preferences and settings',
          additionalProperties: true,
          example: { theme: 'dark', notifications: true },
        },
        createdAt: {
          type: 'string',
          description: 'ISO 8601 timestamp of user creation',
          example: '2026-01-15T10:30:00.000Z',
        },
        wallets: {
          type: 'array',
          description: 'Connected Solana wallets',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique wallet identifier',
                example: 'clx2b3c4d5e6f7g8h9i0j',
              },
              address: {
                type: 'string',
                description: 'Solana wallet address',
                example: 'FzYq8M9XYz...',
              },
              network: {
                type: 'string',
                description: 'Solana network (mainnet-beta, devnet, testnet)',
                example: 'mainnet-beta',
              },
              label: {
                type: 'string',
                nullable: true,
                description: 'User-defined wallet label',
                example: 'Trading Wallet',
              },
            },
            required: ['id', 'address', 'network'],
          },
        },
      },
      required: ['id', 'createdAt', 'wallets'],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required or invalid token',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  async getCurrentUser(@Request() req: { user: { id: string } }) {
    return this.authService.getCurrentUser(req.user.id);
  }
}
