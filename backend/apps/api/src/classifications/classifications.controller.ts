import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ClassificationsService } from './classifications.service';
import { ResolveClassificationDto, BatchResolveDto } from './dto';

@ApiTags('classifications')
@Controller('classifications')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClassificationsController {
  constructor(private classificationsService: ClassificationsService) {}

  @Get('pending')
  @ApiOperation({ summary: 'List pending classification items' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiOkResponse({ description: 'Pending items sorted by estimated value DESC' })
  async getPending(
    @Request() req: { user: { id: string } },
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.classificationsService.getPending(req.user.id, {
      take: take != null ? Number(take) : undefined,
      skip: skip != null ? Number(skip) : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get classification statistics' })
  @ApiOkResponse({
    description: 'Counts of pending, resolved, and auto-resolved items',
    schema: {
      type: 'object',
      properties: {
        pending: { type: 'integer' },
        resolved: { type: 'integer' },
        autoResolved: { type: 'integer' },
      },
    },
  })
  async getStats(@Request() req: { user: { id: string } }) {
    return this.classificationsService.getStats(req.user.id);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List available tax categories with fiscal impact' })
  @ApiOkResponse({ description: 'All tax categories' })
  async getCategories() {
    return this.classificationsService.getCategories();
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resolve a single pending classification' })
  @ApiOkResponse({ description: 'Resolved classification' })
  async resolve(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: ResolveClassificationDto,
  ) {
    return this.classificationsService.resolve(
      id,
      req.user.id,
      dto.category,
      dto.notes,
    );
  }

  @Post('batch-resolve')
  @ApiOperation({ summary: 'Resolve multiple pending classifications at once' })
  @ApiOkResponse({
    description: 'Number of resolved items',
    schema: {
      type: 'object',
      properties: { count: { type: 'integer' } },
    },
  })
  async batchResolve(
    @Request() req: { user: { id: string } },
    @Body() dto: BatchResolveDto,
  ) {
    return this.classificationsService.batchResolve(
      req.user.id,
      dto.ids,
      dto.category,
    );
  }
}
