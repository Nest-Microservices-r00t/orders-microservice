import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { PaginationDto } from 'src/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto, PaidOrderDto } from './dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-products.interface';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  constructor(
    @Inject(NATS_SERVICE) private readonly natsClient: ClientProxy,
  ) {
    super();
  }

  private readonly logger = new Logger('OrdersService');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database conected');
  }
  async create(createOrderDto: CreateOrderDto) {

    try {

      const productIds = createOrderDto.items.map(item => item.productId);

      const products = await firstValueFrom(
        this.natsClient.send({ cmd: 'validate_products' }, productIds)
      );

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(item => item.id === orderItem.productId).price;
        return acc + (price * orderItem.quantity);
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);


      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          status: OrderStatus.PENDING,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map(item => {
                const product = products.find(product => product.id === item.productId);
                return {
                  productId: product.id,
                  price: product.price,
                  quantity: item.quantity
                }
              })
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true
            }
          }
        }
      })

      return {
        ...order,
        OrderItem: order.OrderItem.map(orderItem => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };

    } catch (error) {
      this.logger.error(error);
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs'
      });
    }

  }

  async findAll(paginationDto: OrderPaginationDto) {
    const { limit, page, status } = paginationDto;

    const [totalPage, data] = await Promise.all([
      this.order.count({
        where: { status }
      }),
      this.order.findMany({
        where: { status },
        skip: (page - 1) * limit,
        take: limit,
      })
    ]);

    const lastPage = Math.ceil(totalPage / limit);

    return {
      data,
      meta: {
        total: totalPage,
        page,
        lastPage
      }
    }
  }

  async findAllByStatus(status: OrderStatus, paginationDto: PaginationDto) {

    const { limit, page } = paginationDto;

    const [totalPage, data] = await Promise.all([
      this.order.count({
        where: { status }
      }),
      this.order.findMany({
        where: { status },
        skip: (page - 1) * limit,
        take: limit,
      })
    ]);

    return {
      data,
      meta: {
        total: totalPage,
      }
    }
  }

  async findOne(id: string) {
    const order = await this.order.findUnique({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true
          }
        }
      }
    });

    if (!order) throw new RpcException({
      message: `Order with id ${id} not found`,
      status: HttpStatus.NOT_FOUND
    });

    const orderProductsIds = order.OrderItem.map(orderItem => orderItem.productId);

    const products = await firstValueFrom(this.natsClient.send({ cmd: 'validate_products' }, orderProductsIds));

    return {
      ...order,
      OrderItem: order.OrderItem.map(orderItem => ({
        ...orderItem,
        name: products.find(product => product.id === orderItem.productId).name
      }))
    };
  }


  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const order = await this.findOne(id);

    if (order.status === status) return order;

    return this.order.update({
      where: { id },
      data: { status }
    });
  }

  async createPaymentSession(order: OrderWithProducts) {

    const paymentSessionData = {
      orderId: order.id,
      currency: 'usd',
      items: order.OrderItem.map(item => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity
      }))
    };

    const paymentSession = await firstValueFrom(
      this.natsClient.send('create.payment.session', paymentSessionData)
    );

    return paymentSession;
  }

  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Paid order')
    this.logger.log(paidOrderDto)

    const order = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: "PAID",
        paid: true,
        paidAt: new Date(),
        paymentChargeId: paidOrderDto.stripePaymentId,

        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    });

    return order;

  }

}
