# webrtc-signaling

## execute on local

```sh
docker-compose build
docker-compose up
```
open localhost:8080

## execute on gke

```sh
docker-compose build
docker push gcr.io/{YOUR_PROJECT_ID}/signaling:v1
kubectl apply -f k8s
```
