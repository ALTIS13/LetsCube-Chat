FROM nginx:alpine

COPY docs/deploy/release-catalog/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
