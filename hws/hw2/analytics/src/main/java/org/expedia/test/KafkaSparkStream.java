package org.expedia.test;

import java.util.HashMap;
import java.util.Map;

import scala.Tuple2;

import org.apache.spark.streaming.Duration;
import org.apache.spark.streaming.api.java.JavaPairDStream;
import org.apache.spark.streaming.api.java.JavaDStream;
import org.apache.spark.streaming.api.java.JavaStreamingContext;
import org.apache.spark.streaming.kafka.KafkaUtils;
import org.apache.spark.api.java.function.*;
import org.apache.spark.api.java.JavaPairRDD;

public class KafkaSparkStream {
    public static void main(String[] args) {
        JavaStreamingContext context = new JavaStreamingContext("local", "lz_omniture_stream", new Duration(60*1000));

        Map<String, Integer> topic = new HashMap<String, Integer>();
        Integer partition = Integer.valueOf(1);
        topic.put("test", partition);

        JavaPairDStream<String, String> messadges = KafkaUtils.createStream(context, "localhost:2181", "test-consumer-group", topic);

        // JavaDStream<String> words = messadges.map(new RunStream);

        messadges.print();

        // Get the lines, split them into words, count the words and print
        JavaDStream<String> lines = messadges.map(new Function<Tuple2<String, String>, String>() {
          @Override
          public String call(Tuple2<String, String> tuple2) {
            return tuple2._2();
          }
        });

        JavaPairDStream<String, Integer> wordCounts = lines.mapToPair(
          new PairFunction<String, String, Integer>() {
            @Override
            public Tuple2<String, Integer> call(String s) {
              return new Tuple2<String, Integer>(s, 1);
            }
          }).reduceByKey(
            new Function2<Integer, Integer, Integer>() {
            @Override
            public Integer call(Integer i1, Integer i2) {
              return i1 + i2;
            }

          });

          //Swap the key-value pairs for the counts (in order to sort hashtags by their counts)
         JavaPairDStream<Integer, String> swappedCounts = wordCounts.mapToPair(
           new PairFunction<Tuple2<String, Integer>, Integer, String>() {
             public Tuple2<Integer, String> call(Tuple2<String, Integer> in) {
               return in.swap();
             }
           }
         );

         //Sort swapped map from highest to lowest
         JavaPairDStream<Integer, String> sortedCounts = swappedCounts.transformToPair(
           new Function<JavaPairRDD<Integer, String>, JavaPairRDD<Integer, String>>() {
             public JavaPairRDD<Integer, String> call(JavaPairRDD<Integer, String> in) throws Exception {
               return in.sortByKey(false);
             }
           });

        //Print top 10 hashtags
       sortedCounts.foreach(
         new Function<JavaPairRDD<Integer, String>, Void> () {
           public Void call(JavaPairRDD<Integer, String> rdd) {
             String out = "\nTop 10 hashtags:\n";
             for (Tuple2<Integer, String> t: rdd.take(10)) {
               out = out + t.toString() + "\n";
             }
             System.out.println(out);
             return null;
           }
         }
       );



        context.start();
        context.awaitTermination();
    }
}
