# webrtc-signaling

## execute on local

```sh
docker-compose build
docker-compose up
```

## execute on gke

```sh
docker-compose build
docker push gcr.io/{YOUR_PROJECT_ID}/web:v1
kubectl apply -f k8s
```
