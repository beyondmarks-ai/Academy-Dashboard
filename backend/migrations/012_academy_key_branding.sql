UPDATE api_subscriptions
SET provider = 'Beyond Marks AI Academy'
WHERE credential_kind = 'academy_gateway'
  AND provider IS DISTINCT FROM 'Beyond Marks AI Academy';
