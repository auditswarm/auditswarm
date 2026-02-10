import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { WebhooksService } from "./webhooks.service";

@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post("helius")
  @HttpCode(200)
  @ApiOperation({
    summary: "Helius webhook endpoint for real-time transaction data",
  })
  @ApiHeader({
    name: "authorization",
    description: "Helius webhook auth header",
  })
  @ApiOkResponse({
    description: "Webhook payload received and queued for processing",
    schema: {
      type: "object",
      properties: {
        received: { type: "boolean", example: true },
        queued: {
          type: "integer",
          description: "Number of transactions queued",
        },
      },
    },
  })
  async handleHeliusWebhook(
    @Headers("authorization") authHeader: string,
    @Body() payload: any[],
  ) {
    return this.webhooksService.processHeliusWebhook(authHeader ?? "", payload);
  }
}
