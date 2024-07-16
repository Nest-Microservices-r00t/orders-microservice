import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { PaginationDto } from 'src/common';
import { RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto } from './dto';
import { OrderStatusList } from './enum/order.enum';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database conected');
  }
  create(createOrderDto: CreateOrderDto) {
    return this.order.create({
      data: createOrderDto
    });
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
      where: { id }
    });

    if (!order) throw new RpcException({
      message: `Order with id ${id} not found`,
      status: HttpStatus.NOT_FOUND
    });

    return order;
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

}
