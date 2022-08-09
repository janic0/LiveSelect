FROM node:18

ENV NODE_ENV production
WORKDIR /app
COPY package.json .
RUN npm install --include=dev
COPY . .
RUN npm run build
RUN mv public dist
CMD [ "node", "./dist/server.js" ]