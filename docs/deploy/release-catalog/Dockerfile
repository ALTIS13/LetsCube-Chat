FROM nginx:alpine

COPY docs/deploy/release-catalog/nginx-main.conf /etc/nginx/nginx.conf
COPY docs/deploy/release-catalog/nginx.conf /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
