FROM node:16-alpine
LABEL maintainer="tequ <develoQ.jp@gmail.com>"

RUN mkdir /faucet
ADD . / faucet/
RUN npm --prefix faucet install

WORKDIR /faucet

CMD npm start
