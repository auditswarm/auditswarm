import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { X402Service } from './x402.service';
import { PAYMENT_REQUIRED_KEY, PaymentRequiredOptions } from './decorators';
import type { X402Response } from './types';

@Injectable()
export class X402Guard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private x402Service: X402Service,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if x402 is enabled
    if (!this.x402Service.isEnabled()) {
      return true;
    }

    // Get payment requirements from decorator
    const paymentRequired = this.reflector.getAllAndOverride<PaymentRequiredOptions>(
      PAYMENT_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!paymentRequired) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const paymentHeader = request.headers['payment'] || request.headers['x-payment'];

    // No payment header - return 402
    if (!paymentHeader) {
      throw this.createPaymentRequiredResponse(paymentRequired, request);
    }

    // Parse and verify payment
    const parsed = this.x402Service.parsePaymentHeader(paymentHeader);
    if (!parsed) {
      throw this.createPaymentRequiredResponse(paymentRequired, request, 'Invalid payment header');
    }

    const verification = await this.x402Service.verifyPayment(
      parsed,
      paymentRequired.amount,
      paymentRequired.currency || 'USDC',
    );

    if (!verification.valid) {
      throw this.createPaymentRequiredResponse(
        paymentRequired,
        request,
        verification.error || 'Payment verification failed',
      );
    }

    // Payment verified - attach to request for later use
    request.payment = {
      payerAddress: verification.payerAddress,
      amount: verification.amount,
      currency: verification.currency,
      signature: verification.signature,
    };

    // Settle the payment
    await this.x402Service.settlePayment(
      verification.payerAddress!,
      verification.signature!,
      paymentRequired.resource,
      request.params.id || 'new',
    );

    return true;
  }

  private createPaymentRequiredResponse(
    options: PaymentRequiredOptions,
    request: any,
    errorMessage?: string,
  ): HttpException {
    const instructions = this.x402Service.createPaymentInstructions({
      payTo: options.payTo || '',
      amount: options.amount,
      currency: options.currency || 'USDC',
      network: options.network || 'solana:devnet',
      resource: options.resource,
      resourceId: request.params.id,
      description: options.description,
    });

    const response: X402Response = {
      error: 'payment_required',
      code: 402,
      message: errorMessage || `Payment required: ${options.description || options.resource}`,
      instructions,
    };

    throw new HttpException(response, HttpStatus.PAYMENT_REQUIRED);
  }
}
