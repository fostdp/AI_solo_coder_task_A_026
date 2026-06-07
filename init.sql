-- 城市内涝监测预警系统数据库初始化脚本
-- 含按月分区、索引优化

SELECT 'CREATE DATABASE flood_monitoring'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'flood_monitoring')\gexec

\c flood_monitoring

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

CREATE TABLE IF NOT EXISTS monitoring_points (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    address VARCHAR(255),
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    warning_threshold_orange NUMERIC(5,2) DEFAULT 15.00,
    warning_threshold_red NUMERIC(5,2) DEFAULT 30.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS water_level_data (
    id BIGSERIAL,
    point_id INTEGER NOT NULL REFERENCES monitoring_points(id) ON DELETE CASCADE,
    water_level NUMERIC(6,2) NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS rainfall_data (
    id BIGSERIAL,
    point_id INTEGER NOT NULL REFERENCES monitoring_points(id) ON DELETE CASCADE,
    rainfall NUMERIC(6,2) NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    point_id INTEGER REFERENCES monitoring_points(id) ON DELETE CASCADE,
    alert_level VARCHAR(20) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    water_level NUMERIC(6,2),
    predicted_level NUMERIC(6,2),
    message TEXT,
    triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    is_resolved BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    point_id INTEGER REFERENCES monitoring_points(id) ON DELETE CASCADE,
    current_level NUMERIC(6,2) NOT NULL,
    rainfall_last_hour NUMERIC(6,2) NOT NULL,
    change_rate NUMERIC(6,4) NOT NULL,
    predicted_peak NUMERIC(6,2) NOT NULL,
    prediction_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP NOT NULL,
    rain_stopped BOOLEAN DEFAULT FALSE
);

-- 按月分区：水位数据（2025年6月 ~ 2026年12月）
CREATE TABLE water_level_data_2025_06 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE water_level_data_2025_07 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE water_level_data_2025_08 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE water_level_data_2025_09 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE water_level_data_2025_10 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE water_level_data_2025_11 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE water_level_data_2025_12 PARTITION OF water_level_data
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE water_level_data_2026_01 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE water_level_data_2026_02 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE water_level_data_2026_03 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE water_level_data_2026_04 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE water_level_data_2026_05 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE water_level_data_2026_06 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE water_level_data_2026_07 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE water_level_data_2026_08 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE water_level_data_2026_09 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE water_level_data_2026_10 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE water_level_data_2026_11 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE water_level_data_2026_12 PARTITION OF water_level_data
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE water_level_data_default PARTITION OF water_level_data
    DEFAULT;

-- 按月分区：雨量数据（2025年6月 ~ 2026年12月）
CREATE TABLE rainfall_data_2025_06 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE rainfall_data_2025_07 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE rainfall_data_2025_08 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE rainfall_data_2025_09 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE rainfall_data_2025_10 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE rainfall_data_2025_11 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE rainfall_data_2025_12 PARTITION OF rainfall_data
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE rainfall_data_2026_01 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE rainfall_data_2026_02 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE rainfall_data_2026_03 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE rainfall_data_2026_04 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE rainfall_data_2026_05 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE rainfall_data_2026_06 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE rainfall_data_2026_07 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE rainfall_data_2026_08 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE rainfall_data_2026_09 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE rainfall_data_2026_10 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE rainfall_data_2026_11 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE rainfall_data_2026_12 PARTITION OF rainfall_data
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE rainfall_data_default PARTITION OF rainfall_data
    DEFAULT;

-- 索引：水位数据
CREATE INDEX IF NOT EXISTS idx_water_level_point_time
    ON water_level_data(point_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_water_level_recorded_at
    ON water_level_data(recorded_at DESC);

-- 索引：雨量数据
CREATE INDEX IF NOT EXISTS idx_rainfall_point_time
    ON rainfall_data(point_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_rainfall_recorded_at
    ON rainfall_data(recorded_at DESC);

-- 索引：告警数据
CREATE INDEX IF NOT EXISTS idx_alerts_point_time
    ON alerts(point_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_level_time
    ON alerts(alert_level, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active
    ON alerts(point_id, is_resolved, triggered_at DESC)
    WHERE is_resolved = FALSE;

-- 索引：预测数据
CREATE INDEX IF NOT EXISTS idx_predictions_point_time
    ON predictions(point_id, prediction_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_valid
    ON predictions(point_id, valid_until DESC)
    WHERE valid_until > NOW();

-- 索引：地理数据
CREATE INDEX IF NOT EXISTS idx_monitoring_points_location
    ON monitoring_points USING GIST(location);

-- 插入20个易涝点数据
INSERT INTO monitoring_points (name, code, address, location, warning_threshold_orange, warning_threshold_red) VALUES
('人民路与建设路交叉口', 'P001', '人民路与建设路交叉口东南角', ST_SetSRID(ST_MakePoint(116.397, 39.908), 4326), 15.00, 30.00),
('火车站站前广场', 'P002', '火车站站前广场地下通道入口', ST_SetSRID(ST_MakePoint(116.405, 39.912), 4326), 15.00, 30.00),
('市政府门前', 'P003', '市政府门前辅路', ST_SetSRID(ST_MakePoint(116.392, 39.915), 4326), 15.00, 30.00),
('中心公园北门', 'P004', '中心公园北门地下车库入口', ST_SetSRID(ST_MakePoint(116.400, 39.920), 4326), 15.00, 30.00),
('商业步行街北口', 'P005', '商业步行街北口', ST_SetSRID(ST_MakePoint(116.408, 39.916), 4326), 15.00, 30.00),
('第一中学门口', 'P006', '第一中学门口人行道', ST_SetSRID(ST_MakePoint(116.385, 39.910), 4326), 15.00, 30.00),
('人民医院急诊入口', 'P007', '人民医院急诊入口处', ST_SetSRID(ST_MakePoint(116.395, 39.898), 4326), 15.00, 30.00),
('体育馆西门', 'P008', '体育馆西门停车场入口', ST_SetSRID(ST_MakePoint(116.415, 39.905), 4326), 15.00, 30.00),
('立交桥下', 'P009', '东三环立交桥下辅路', ST_SetSRID(ST_MakePoint(116.420, 39.918), 4326), 15.00, 30.00),
('地铁站出口', 'P010', '地铁1号线中心站A出口', ST_SetSRID(ST_MakePoint(116.402, 39.905), 4326), 15.00, 30.00),
('科技园区南门', 'P011', '科技园区南门主干道', ST_SetSRID(ST_MakePoint(116.380, 39.925), 4326), 15.00, 30.00),
('居民区入口', 'P012', '阳光花园小区入口', ST_SetSRID(ST_MakePoint(116.410, 39.895), 4326), 15.00, 30.00),
('高速出口', 'P013', '京通高速城区出口辅路', ST_SetSRID(ST_MakePoint(116.425, 39.890), 4326), 15.00, 30.00),
('批发市场门前', 'P014', '东郊批发市场北门', ST_SetSRID(ST_MakePoint(116.375, 39.900), 4326), 15.00, 30.00),
('旅游景区入口', 'P015', '古城景区主入口', ST_SetSRID(ST_MakePoint(116.388, 39.922), 4326), 15.00, 30.00),
('购物中心停车场', 'P016', '万达广场地下停车场入口', ST_SetSRID(ST_MakePoint(116.412, 39.910), 4326), 15.00, 30.00),
('公交枢纽', 'P017', '城西公交枢纽站', ST_SetSRID(ST_MakePoint(116.370, 39.908), 4326), 15.00, 30.00),
('工业区主干道', 'P018', '经济开发区核心路段', ST_SetSRID(ST_MakePoint(116.430, 39.922), 4326), 15.00, 30.00),
('河岸边道路', 'P019', '通惠河南岸沿河路', ST_SetSRID(ST_MakePoint(116.406, 39.888), 4326), 15.00, 30.00),
('学校周边路段', 'P020', '实验小学周边路段', ST_SetSRID(ST_MakePoint(116.382, 39.895), 4326), 15.00, 30.00)
ON CONFLICT (code) DO NOTHING;

-- 创建自动分区维护函数
CREATE OR REPLACE FUNCTION create_monthly_partitions()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    start_date TEXT;
    end_date TEXT;
    table_suffix TEXT;
BEGIN
    partition_date := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
    start_date := to_char(partition_date, 'YYYY-MM-DD');
    end_date := to_char(partition_date + INTERVAL '1 month', 'YYYY-MM-DD');
    table_suffix := to_char(partition_date, 'YYYY_MM');

    BEGIN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS water_level_data_%s PARTITION OF water_level_data
             FOR VALUES FROM (%L) TO (%L)',
            table_suffix, start_date, end_date
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS rainfall_data_%s PARTITION OF rainfall_data
             FOR VALUES FROM (%L) TO (%L)',
            table_suffix, start_date, end_date
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END;
$$ LANGUAGE plpgsql;

-- 创建视图：获取各点位最新水位
CREATE OR REPLACE VIEW latest_water_level AS
SELECT DISTINCT ON (p.id)
    p.id,
    p.name,
    p.code,
    p.address,
    ST_AsGeoJSON(p.location) as location,
    w.water_level,
    w.recorded_at as last_report_time,
    p.warning_threshold_orange,
    p.warning_threshold_red
FROM monitoring_points p
LEFT JOIN water_level_data w ON p.id = w.point_id
WHERE p.is_active = TRUE
ORDER BY p.id, w.recorded_at DESC;

-- 创建视图：获取各点位最近1小时降雨量
CREATE OR REPLACE VIEW recent_rainfall AS
SELECT
    p.id,
    p.code,
    COALESCE(SUM(r.rainfall), 0) as rainfall_last_hour
FROM monitoring_points p
LEFT JOIN rainfall_data r ON p.id = r.point_id
    AND r.recorded_at >= NOW() - INTERVAL '1 hour'
WHERE p.is_active = TRUE
GROUP BY p.id, p.code;
