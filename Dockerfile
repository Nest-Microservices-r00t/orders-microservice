FROM node:21-alpine3.20
WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./


RUN npm install

COPY . .

EXPOSE 3002